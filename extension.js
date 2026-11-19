const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const chat = require('./webviews/chat');
const artifact = require('./webviews/artifact');
const backend = require('./backend');
const changes = require('./changes');

// The chat lives in the Secondary Side Bar by default. A conversation can be
// opened in an editor tab/window only on an explicit request. Both surfaces
// share one conversation and stay in sync.

let chatView = null;        // the sidebar WebviewView
let windowPanel = null;     // optional WebviewPanel (editor tab / window)
let artifactPanel = null;
let globalExtensionUri = null;

// The single active conversation.
const convo = { threadId: '', title: 'New conversation', messages: [], busy: false, child: null };

// Prompt history for Up/Down recall in the composer. Persisted in globalState
// so it survives reloads and is shared by the sidebar and the optional window.
const PROMPT_HISTORY_KEY = 'perchai.promptHistory';
let promptHistory = [];
let extensionContext = null;

// Temp directory holding files dropped into the chat. Recreated per batch and
// removed once the message is sent (or on reset/deactivate).
let dropDir = null;
function cleanupDropDir() {
  if (dropDir) { try { fs.rmSync(dropDir, { recursive: true, force: true }); } catch (_) {} dropDir = null; }
}

// Pending change set from the last run, awaiting Accept/Reject.
let pendingChanges = null;

function codiconUri(webview, extensionUri) {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'codicon', 'codicon.css')
  ).toString();
}

// Post a message to every chat surface that is currently open.
function postToChat(type, payload) {
  const msg = Object.assign({ type }, payload || {});
  if (chatView) chatView.webview.postMessage(msg);
  if (windowPanel) windowPanel.webview.postMessage(msg);
}

// Prompt history helpers.
function loadPromptHistory() {
  if (!extensionContext) return;
  const saved = extensionContext.globalState.get(PROMPT_HISTORY_KEY, []);
  promptHistory = Array.isArray(saved) ? saved.filter(s => typeof s === 'string') : [];
}
function pushPrompt(text) {
  const t = String(text || '').trim();
  if (!t) return;
  // Avoid consecutive duplicates; cap length to keep state small.
  if (promptHistory[promptHistory.length - 1] !== t) promptHistory.push(t);
  if (promptHistory.length > 200) promptHistory = promptHistory.slice(-200);
  if (extensionContext) extensionContext.globalState.update(PROMPT_HISTORY_KEY, promptHistory);
  postToChat('promptHistory', { history: effectivePromptHistory() });
}

// Up/Down recall must also work in a loaded historical conversation. Merge the
// current conversation's own user prompts with the global history, newest last,
// de-duplicated. This way switching threads changes what Up walks through.
function effectivePromptHistory() {
  const fromConvo = (convo.messages || [])
    .filter(m => m && m.role === 'user' && typeof m.text === 'string' && m.text.trim())
    .map(m => m.text.trim());
  const merged = [];
  const seen = new Set();
  for (const t of promptHistory.concat(fromConvo)) {
    if (!seen.has(t)) { seen.add(t); merged.push(t); }
  }
  if (merged.length > 200) return merged.slice(-200);
  return merged;
}
function sendPromptHistory(webview) {
  webview.postMessage({ type: 'promptHistory', history: effectivePromptHistory() });
}

function initChatSurface(webview, extensionUri) {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
  };
  webview.html = chat.getHtml(webview, extensionUri, codiconUri(webview, extensionUri));
}

function sendInitialState(webview) {
  const settings = backend.getSettings();
  webview.postMessage({ type: 'status', cwd: settings.cwd, cwdName: path.basename(settings.cwd) });
  webview.postMessage({ type: 'sessionMeta', title: convo.title, threadId: convo.threadId });
  sendPromptHistory(webview);
  if (convo.messages.length) {
    webview.postMessage({ type: 'threadLoaded', messages: convo.messages, threadId: convo.threadId });
  }
  backend.checkStatus().then((st) => webview.postMessage({ type: 'cliStatus', st }));
}

function shortTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 42 ? t.slice(0, 42) + '…' : (t || 'New conversation');
}

// ---------- Conversation actions ----------
function resetConversation() {
  if (convo.child) { try { convo.child.kill('SIGTERM'); } catch (_) {} }
  if (pendingChanges) { changes.cleanup(pendingChanges); pendingChanges = null; }
  cleanupDropDir();
  convo.child = null;
  convo.busy = false;
  convo.threadId = '';
  convo.title = 'New conversation';
  convo.messages = [];
  // Reload each surface to get the clean empty state with example prompts.
  // Reload each surface; the webview posts 'ready' and we then send state.
  if (chatView) initChatSurface(chatView.webview, globalExtensionUri);
  if (windowPanel) {
    initChatSurface(windowPanel.webview, globalExtensionUri);
    windowPanel.title = convo.title;
  }
}

function loadConversation(t) {
  const loaded = backend.readThread(t.id);
  convo.threadId = t.id;
  convo.title = shortTitle(t.title);
  convo.messages = loaded ? loaded.messages : [];
  convo.busy = false;
  if (windowPanel) windowPanel.title = convo.title;
  postToChat('sessionMeta', { title: convo.title, threadId: convo.threadId });
  postToChat('threadLoaded', { messages: convo.messages, threadId: convo.threadId });
  postToChat('promptHistory', { history: effectivePromptHistory() });
  // Focus the sidebar chat where the conversation is shown by default.
  vscode.commands.executeCommand('perchai.chat.focus');
}

async function runTurn(msg) {
  if (convo.busy) {
    postToChat('error', { message: 'A run is already in progress.' });
    return;
  }
  // The CLI's vision helper fails on images in this environment (verified with
  // PNG/JPEG from both temp and workspace paths), so an image attachment only
  // produces "Unreadable." Stop before spending a run and say why.
  const imageRe = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|svg)$/i;
  const hasImage = (msg.attachments || []).some(p => imageRe.test(p || ''));
  if (hasImage) {
    postToChat('error', {
      message: 'Image attachments can\'t be read by the Perch CLI here (its vision helper fails in this environment). Open the image in Perch Desktop for image questions, or attach text/PDF instead. No run was spent.'
    });
    return;
  }
  pushPrompt(msg.text); // record for Up/Down recall
  // Snapshot the workspace before the run so we can show/undo its changes.
  const cwdForRun = msg.cwd || backend.getSettings().cwd;
  let snap = null;
  try { snap = changes.snapshot(cwdForRun); } catch (_) {}
  postToChat('runStart', { text: msg.text });
  convo.busy = true;
  try {
    const result = await backend.runTurn(msg.text, {
      cwd: msg.cwd || undefined,
      mode: msg.mode, permission: msg.permission, persona: msg.persona, model: msg.model,
      effort: msg.effort, attachments: msg.attachments, skills: msg.skills,
      threadId: convo.threadId, // explicit: '' means a brand-new thread
      onProcess: (child) => { convo.child = child; }
    });
    convo.child = null;
    convo.busy = false;
    cleanupDropDir(); // CLI has finished reading the attached files
    if (!convo.threadId && result.threadId) convo.threadId = result.threadId;
    if (convo.messages.length === 0) {
      convo.title = shortTitle(msg.text);
      if (windowPanel) windowPanel.title = convo.title;
    }
    convo.messages.push({ role: 'user', text: msg.text });
    convo.messages.push({ role: 'assistant', text: result.assistantText || '' });
    postToChat('sessionMeta', { title: convo.title, threadId: convo.threadId });
    postToChat('runDone', {
      text: result.assistantText || '',
      threadId: convo.threadId,
      progress: backend.progressFromResult(result),
      durationMs: result.durationMs || 0,
      status: result.status || 'completed'
    });
    // Report workspace changes detected during this run (optional UI).
    if (snap) {
      try {
        const report = changes.detect(snap);
        if (report.files.length) {
          pendingChanges = snap; // keep backup for Reject; Accept discards it
          postToChat('workspaceChanges', { files: report.files, git: report.git });
        } else {
          changes.cleanup(snap);
        }
      } catch (_) { changes.cleanup(snap); }
    }
  } catch (e) {
    convo.child = null;
    convo.busy = false;
    cleanupDropDir();
    postToChat('error', { message: e.message || String(e) });
  }
}

// Write dropped files (base64 from the webview) to a temp folder and report
// them through the same filesAttached channel used by the picker.
function saveDroppedFiles(files) {
  try {
    if (!dropDir) {
      dropDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perchai-drop-'));
    }
    const saved = [];
    for (const f of (files || [])) {
      const safeName = path.basename(f.name || 'dropped-file').replace(/[^A-Za-z0-9._ -]/g, '_');
      const dest = path.join(dropDir, safeName);
      fs.writeFileSync(dest, Buffer.from(f.data || '', 'base64'));
      saved.push({ path: dest, name: safeName });
    }
    postToChat('filesAttached', { files: saved });
    vscode.window.setStatusBarMessage(
      `PerchAI: attached ${saved.length} dropped file${saved.length === 1 ? '' : 's'}`, 2500
    );
  } catch (e) {
    postToChat('dropError', { message: 'Could not save dropped file(s): ' + (e.message || e) });
  }
}

// ---------- Message routing (from sidebar or window) ----------
function handleChatMessage(msg, view) {
  switch (msg.type) {
    case 'ready':
      // Webview has registered its listener; now it is safe to send state.
      if (view) sendInitialState(view);
      break;
    case 'send': runTurn(msg); break;
    case 'stop':
      if (convo.child) {
        try { convo.child.kill('SIGTERM'); } catch (_) {}
        convo.child = null; convo.busy = false;
        postToChat('stopped', {});
      }
      break;
    case 'newChat': vscode.commands.executeCommand('perchai.newSession'); break;
    case 'openHistory': vscode.commands.executeCommand('perchai.showHistory'); break;
    case 'openInWindow': vscode.commands.executeCommand('perchai.openInWindow'); break;
    case 'chooseFolder': vscode.commands.executeCommand('perchai.chooseFolder'); break;
    case 'attachFiles': vscode.commands.executeCommand('perchai.attachFiles'); break;
    case 'droppedFiles': saveDroppedFiles(msg.files); break;
    case 'chooseSkill': vscode.commands.executeCommand('perchai.chooseSkill'); break;
    case 'undo': vscode.commands.executeCommand('perchai.undo'); break;
    case 'acceptChanges': vscode.commands.executeCommand('perchai.acceptChanges'); break;
    case 'rejectChanges': vscode.commands.executeCommand('perchai.rejectChanges'); break;
    case 'viewChange': {
      // Return a diff for one changed file so the user can review before deciding.
      let rows = null;
      try { rows = pendingChanges ? changes.getDiff(pendingChanges, msg.path) : null; }
      catch (_) { rows = null; }
      if (view) view.webview.postMessage({
        type: 'changeDiff', path: msg.path, rows: rows || [{ type: 'hunk', text: 'Diff unavailable' }]
      });
      break;
    }
    case 'manageAccount':
    case 'login':
    case 'logout': vscode.commands.executeCommand('perchai.manageAccount'); break;
    case 'refreshStatus':
      backend.checkStatus().then((st) => postToChat('cliStatus', st));
      break;
    case 'openArtifact': openArtifact(globalExtensionUri, msg.id, msg.kind); break;
  }
}

// ---------- Native history Quick Pick ----------
async function showHistoryQuickPick() {
  const threads = backend.listThreads();
  const items = threads.map((t) => ({
    label: '$(comment-discussion) ' + (t.title || '(untitled)'),
    description: (t.messageCount || 0) + ' messages',
    detail: (t.cwd || '') + '   ·   ' + (t.updatedAt ? new Date(t.updatedAt).toLocaleString() : ''),
    thread: t, kind: 'open'
  }));
  items.push({ label: '$(add) New conversation', detail: 'Start a fresh conversation', kind: 'new' });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'PerchAI conversations  (type to filter)',
    matchOnDescription: true, matchOnDetail: true
  });
  if (!picked) return;
  if (picked.kind === 'new') { vscode.commands.executeCommand('perchai.newSession'); return; }
  loadConversation(picked.thread);
}

// ---------- Account Quick Pick ----------
async function manageAccount() {
  const st = await backend.checkStatus();
  const routing = await backend.getRouting();
  const picked = await vscode.window.showQuickPick([
    { label: '$(dashboard) Usage', description: 'Show Perch Token allowance', kind: 'usage' },
    { label: '$(radio-tower) Model routing', description: routing.mode, kind: 'routing' },
    { label: '$(account) Sign in with Google', kind: 'google' },
    { label: '$(github) Sign in with GitHub', kind: 'github' },
    { label: '$(sign-out) Sign out', kind: 'logout' }
  ], { placeHolder: st.signedIn ? ('Signed in as ' + (st.email || 'Perch account') + ' · ' + routing.mode) : 'Not signed in' });
  if (!picked) return;
  if (picked.kind === 'usage') {
    const u = await backend.getUsage();
    // Show the full text in an output channel so nothing is truncated.
    if (!manageAccount._out) manageAccount._out = vscode.window.createOutputChannel('PerchAI Usage');
    manageAccount._out.clear();
    manageAccount._out.appendLine(u.text || u.raw || 'No usage data');
    manageAccount._out.show(true);
    return;
  }
  if (picked.kind === 'routing') {
    if (!manageAccount._routeOut) manageAccount._routeOut = vscode.window.createOutputChannel('PerchAI Routing');
    manageAccount._routeOut.clear();
    manageAccount._routeOut.appendLine('Active routing: ' + routing.mode + '\n');
    manageAccount._routeOut.appendLine('--- perch byok status ---\n' + routing.byok);
    manageAccount._routeOut.appendLine('\n--- perch byolm status ---\n' + routing.byolm);
    manageAccount._routeOut.show(true);
    return;
  }
  if (picked.kind === 'logout') {
    const c = await vscode.window.showWarningMessage(
      'Sign out of Perch CLI? Your browser sign-in is not affected.', { modal: true }, 'Sign out'
    );
    if (c !== 'Sign out') return;
    await backend.logout();
    vscode.window.setStatusBarMessage('PerchAI: signed out', 2500);
  } else {
    const r = await backend.login(picked.kind);
    vscode.window.setStatusBarMessage(
      r.ok ? 'PerchAI: sign-in complete' : 'PerchAI: finish sign-in in the browser', 4000
    );
  }
  backend.checkStatus().then((s) => postToChat('cliStatus', s));
}

// ---------- Explicit window ----------
function openInWindow() {
  if (!windowPanel) {
    windowPanel = vscode.window.createWebviewPanel(
      'perchaiChatWindow', convo.title, vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(globalExtensionUri, 'media')] }
    );
    windowPanel.iconPath = new vscode.ThemeIcon('comment-discussion');
    initChatSurface(windowPanel.webview, globalExtensionUri);
    windowPanel.webview.onDidReceiveMessage(handleChatMessage);
    windowPanel.onDidDispose(() => { windowPanel = null; });
  } else {
    windowPanel.title = convo.title;
    windowPanel.reveal(vscode.ViewColumn.Beside);
  }
}

function activate(context) {
  const extensionUri = context.extensionUri;
  globalExtensionUri = extensionUri;
  extensionContext = context;
  loadPromptHistory();
  console.log('PerchAI is now active (sidebar chat).');

  class ChatViewProvider {
    resolveWebviewView(view) {
      chatView = view;
      initChatSurface(view.webview, extensionUri);
      view.webview.onDidReceiveMessage(handleChatMessage);
    }
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('perchai.chat', new ChatViewProvider())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perchai.newSession', () => resetConversation()),
    vscode.commands.registerCommand('perchai.showHistory', () => showHistoryQuickPick()),
    vscode.commands.registerCommand('perchai.manageAccount', () => manageAccount()),
    vscode.commands.registerCommand('perchai.openInWindow', () => openInWindow()),
    vscode.commands.registerCommand('perchai.attachFiles', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
        openLabel: 'Attach', defaultUri: vscode.Uri.file(backend.getSettings().cwd)
      });
      if (!picked || !picked.length) return;
      const files = picked.map(u => ({ path: u.fsPath, name: path.basename(u.fsPath) }));
      postToChat('filesAttached', { files });
      vscode.window.setStatusBarMessage(
        `PerchAI: attached ${files.length} file${files.length === 1 ? '' : 's'}`, 2000
      );
    }),
    vscode.commands.registerCommand('perchai.acceptChanges', () => {
      if (!pendingChanges) {
        vscode.window.setStatusBarMessage('PerchAI: no pending changes to accept', 2000);
        return;
      }
      changes.accept(pendingChanges);
      pendingChanges = null;
      postToChat('changesResolved', { action: 'accept' });
      vscode.window.setStatusBarMessage('PerchAI: changes kept', 2000);
    }),
    vscode.commands.registerCommand('perchai.rejectChanges', async () => {
      if (!pendingChanges) {
        vscode.window.setStatusBarMessage('PerchAI: no pending changes to reject', 2000);
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        'Revert all file changes from the last Perch run?', { modal: true }, 'Revert'
      );
      if (confirm !== 'Revert') return;
      const res = changes.reject(pendingChanges);
      pendingChanges = null;
      postToChat('changesResolved', {
        action: 'reject',
        restored: res.restored,
        removed: res.removed
      });
      vscode.window.setStatusBarMessage('PerchAI: changes reverted', 2500);
    }),
    vscode.commands.registerCommand('perchai.undo', async () => {
      if (!convo.threadId) {
        postToChat('error', { message: 'Nothing to undo yet — no file changes in this conversation.' });
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        'Undo the last file changes made in this conversation?', { modal: true }, 'Undo'
      );
      if (confirm !== 'Undo') return;
      await runTurn({ text: '/undo', mode: 'agents' });
    }),
    vscode.commands.registerCommand('perchai.chooseSkill', async () => {
      const skills = await backend.listSkills();
      const items = skills.map(s => ({
        label: '$(symbol-method) ' + s.id,
        description: s.scope === 'user' ? 'user' : 'built-in',
        detail: (s.description || '').slice(0, 140),
        skillId: s.id
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Choose skill(s) for the next run (type to filter)',
        canPickMany: true, matchOnDetail: true
      });
      if (!picked) return;
      const ids = picked.map(p => p.skillId);
      postToChat('skillChosen', { skills: ids });
      vscode.window.setStatusBarMessage(
        ids.length ? `PerchAI: skill set to ${ids.join(', ')}` : 'PerchAI: no skill', 2500
      );
    }),
    vscode.commands.registerCommand('perchai.chooseFolder', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        openLabel: 'Use this folder'
      });
      if (!picked || !picked[0]) return;
      const folder = picked[0].fsPath;
      await vscode.workspace.getConfiguration('perchai').update(
        'cwd', folder, vscode.ConfigurationTarget.Workspace
      );
      postToChat('status', { cwd: folder, cwdName: path.basename(folder) });
      vscode.window.setStatusBarMessage(`PerchAI: working folder set to ${path.basename(folder)}`, 2500);
    }),
    vscode.commands.registerCommand('perchai.openArtifact', (id, kind) => {
      openArtifact(extensionUri, id || 'plan-dark-mode', kind || 'Implementation Plan');
    }),
    vscode.commands.registerCommand('perchai.toggleSecondarySidebar', () => {
      vscode.commands.executeCommand('workbench.action.toggleAuxiliaryBar');
    })
  );

  // Reveal the sidebar chat on startup.
  setTimeout(() => {
    vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
    vscode.commands.executeCommand('perchai.chat.focus');
  }, 300);
}

function openArtifact(extensionUri, id, kind) {
  const title = kind ? `Artifact: ${kind}` : 'Artifact';
  if (artifactPanel) {
    artifactPanel.title = title;
    artifactPanel.webview.html = artifact.getHtml(
      artifactPanel.webview, extensionUri, id, codiconUri(artifactPanel.webview, extensionUri)
    );
    artifactPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  artifactPanel = vscode.window.createWebviewPanel(
    'perchaiArtifact', title, vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] }
  );
  artifactPanel.webview.html = artifact.getHtml(
    artifactPanel.webview, extensionUri, id, codiconUri(artifactPanel.webview, extensionUri)
  );
  artifactPanel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === 'artifactAction') {
      vscode.window.setStatusBarMessage(`PerchAI: ${msg.action} is a placeholder`, 3000);
    }
  });
  artifactPanel.onDidDispose(() => { artifactPanel = null; });
}

function deactivate() {
  if (convo.child) { try { convo.child.kill('SIGTERM'); } catch (_) {} }
  if (pendingChanges) { changes.cleanup(pendingChanges); pendingChanges = null; }
  cleanupDropDir();
}

module.exports = { activate, deactivate };
