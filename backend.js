// Backend bridge: runs real Perch turns through the installed `perch` CLI.
// Uses the documented one-shot form: perch run "<task>" --json [flags]
// See https://www.perchai.app/docs/using-perch/cli
//
// NOTE: `perch run --json` buffers its output and emits one JSON document at
// the end of the run (verified: ~12s of work, all bytes in the final ~40ms).
// There is no incremental stream to show, so the UI shows an honest working
// state and renders the final answer + progress steps once the run completes.

const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Find the perch executable even when VS Code was launched from the GUI
// (its PATH often omits nvm/npm global bin directories).
function resolvePerchPath(configured) {
  if (configured && configured.trim()) return configured.trim();
  const candidates = [];
  const home = os.homedir();
  try {
    const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
    for (const v of fs.readdirSync(nvmRoot)) {
      candidates.push(path.join(nvmRoot, v, 'bin', 'perch'));
    }
  } catch (_) {}
  candidates.push(
    path.join(home, '.npm-global', 'bin', 'perch'),
    '/usr/local/bin/perch',
    '/opt/homebrew/bin/perch'
  );
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return 'perch'; // fall back to PATH
}

// Build an environment whose PATH includes the directory holding the perch
// binary, so any child processes the CLI spawns can find node and friends.
function buildEnv(perchPath) {
  const env = Object.assign({}, process.env);
  const extra = [];
  const home = os.homedir();
  try {
    const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
    for (const v of fs.readdirSync(nvmRoot)) extra.push(path.join(nvmRoot, v, 'bin'));
  } catch (_) {}
  extra.push(path.dirname(perchPath), '/usr/local/bin', '/opt/homebrew/bin');
  env.PATH = extra.concat([env.PATH || '']).join(path.delimiter);
  return env;
}

function getSettings() {
  const cfg = vscode.workspace.getConfiguration('perchai');
  return {
    cliPath: cfg.get('cliPath', ''),
    cwd: cfg.get('cwd', '') || (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath || os.homedir(),
    mode: cfg.get('mode', 'agents'),
    permission: cfg.get('permission', 'default'),
    persona: cfg.get('persona', ''),
    model: cfg.get('model', ''),
    threadId: cfg.get('threadId', '')
  };
}

function spawnPerch(args, cwd) {
  const perchPath = resolvePerchPath(getSettings().cliPath);
  return cp.spawn(perchPath, args, {
    cwd: cwd || getSettings().cwd,
    env: buildEnv(perchPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

// Quick status check for the header: version + signed-in account.
function checkStatus() {
  return new Promise((resolve) => {
    let child;
    try { child = spawnPerch(['status'], getSettings().cwd); }
    catch (e) { resolve({ ok: false, raw: e.message }); return; }
    let out = '', err = '';
    child.stdout.on('data', c => { out += c.toString(); });
    child.stderr.on('data', c => { err += c.toString(); });
    child.on('error', e => resolve({ ok: false, raw: e.message }));
    child.on('close', () => {
      const raw = (out || err).trim();
      const m = raw.match(/Perch CLI\s+([\d.]+)/);
      const who = raw.match(/Signed in as\s+([^\s·]+)/);
      const signedIn = /signed in as/i.test(raw);
      resolve({
        ok: signedIn,
        signedIn,
        version: m ? m[1] : '',
        email: who ? who[1] : '',
        raw
      });
    });
  });
}

// Sign in. `perch login [provider]` opens a browser tab and saves the session
// once the person completes sign-in there. We resolve when the CLI process
// exits, then the caller re-runs checkStatus to confirm.
function login(provider) {
  return new Promise((resolve) => {
    const args = ['login'];
    if (provider === 'google' || provider === 'github') args.push(provider);
    let child;
    try { child = spawnPerch(args, getSettings().cwd); }
    catch (e) { resolve({ ok: false, message: e.message }); return; }
    let out = '', err = '';
    child.stdout.on('data', c => { out += c.toString(); });
    child.stderr.on('data', c => { err += c.toString(); });
    child.on('error', e => resolve({ ok: false, message: e.message }));
    child.on('close', (code) => {
      const raw = (out || err).trim();
      resolve({ ok: code === 0, code, message: raw, raw });
    });
  });
}

// Sign out of the CLI (browser sign-in is left alone, per the docs).
function logout() {
  return new Promise((resolve) => {
    let child;
    try { child = spawnPerch(['logout'], getSettings().cwd); }
    catch (e) { resolve({ ok: false, message: e.message }); return; }
    let out = '', err = '';
    child.stdout.on('data', c => { out += c.toString(); });
    child.stderr.on('data', c => { err += c.toString(); });
    child.on('error', e => resolve({ ok: false, message: e.message }));
    child.on('close', (code) => {
      const raw = (out || err).trim();
      resolve({ ok: code === 0, code, message: raw, raw });
    });
  });
}

// Run one Perch turn and resolve with the parsed result.
// `opts.onProcess` receives the child so the caller can cancel it.
function runTurn(task, opts) {
  opts = opts || {};
  const settings = getSettings();
  const cwd = opts.cwd || settings.cwd;
  const mode = opts.mode || settings.mode;
  const permission = opts.permission || settings.permission;

  const args = ['run', task, '--json', '--cwd', cwd, '--mode', mode, '--permission', permission];
  if (opts.persona || settings.persona) args.push('--persona', opts.persona || settings.persona);
  if (opts.model || settings.model) args.push('--model', opts.model || settings.model);
  if (opts.effort) args.push('--effort', opts.effort);
  // Repeatable flags, confirmed present in `perch run --help` on v2.4.140.
  if (Array.isArray(opts.attachments)) {
    for (const f of opts.attachments) if (f) args.push('--attach', f);
  }
  if (Array.isArray(opts.skills)) {
    for (const s of opts.skills) if (s) args.push('--skill', s);
  }
  // A session tab passes its own threadId explicitly. Use `hasOwnProperty` so
  // an intentionally empty id (a brand-new session) does not fall back to the
  // workspace setting and accidentally continue a different conversation.
  const threadId = Object.prototype.hasOwnProperty.call(opts, 'threadId')
    ? opts.threadId
    : settings.threadId;
  if (threadId) args.push('--thread', threadId);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnPerch(args, cwd);
    } catch (e) {
      reject(new Error(`Could not start Perch CLI: ${e.message}`));
      return;
    }
    if (opts.onProcess) opts.onProcess(child);

    let stdout = '', stderr = '', settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    child.stdout.on('data', c => { stdout += c.toString(); });
    child.stderr.on('data', c => { stderr += c.toString(); });
    child.on('error', e => finish(reject, new Error(`Perch CLI error: ${e.message}`)));

    child.on('close', (code) => {
      if (settled) return;
      let data;
      try {
        const start = stdout.indexOf('{');
        data = JSON.parse(start >= 0 ? stdout.slice(start) : stdout);
      } catch (e) {
        finish(reject, new Error(
          `Perch CLI exited (${code}) but output was not JSON: ${stdout.slice(0, 300) || stderr.slice(0, 300)}`
        ));
        return;
      }
      if (!data.ok && data.status !== 'completed') {
        if (data.status === 'approval_required') {
          finish(reject, new Error(
            'Perch stopped because this action needs approval, but one-shot runs have no approval prompt. ' +
            'Choose "Auto Review" or "Take the Wheel" in the permission dropdown and send again.'
          ));
          return;
        }
        finish(reject, new Error(data.error || data.message || `Perch run failed (${data.status})`));
        return;
      }
      finish(resolve, data);
    });
  });
}

// Extract a compact, UI-friendly list of progress items from a completed run.
function progressFromResult(data) {
  const items = [];
  for (const ev of (data.events || [])) {
    if (ev.type === 'progress_item_started' && ev.item) {
      const it = ev.item;
      if (it.kind === 'agent_message') continue; // final answer shown separately
      items.push({
        kind: it.kind || 'step',
        title: it.title || '',
        text: it.text || '',
        status: it.status || 'completed'
      });
    }
  }
  return items;
}

// ---------- Conversation history ----------
// Threads live as JSON files under ~/.perch/threads/<userId>/<threadId>.json

function threadsRoot() {
  return path.join(os.homedir(), '.perch', 'threads');
}

// List all saved threads across account directories, newest first.
function listThreads() {
  const root = threadsRoot();
  const out = [];
  try {
    for (const user of fs.readdirSync(root)) {
      const dir = path.join(root, user);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          const msgs = Array.isArray(d.recentMessages) ? d.recentMessages : [];
          const firstUser = msgs.find(m => m && m.role === 'user');
          const title = firstUser && typeof firstUser.text === 'string'
            ? firstUser.text.replace(/\s+/g, ' ').trim().slice(0, 80)
            : (d.threadId || file);
          out.push({
            id: d.threadId || file.replace(/\.json$/, ''),
            title: title || '(empty thread)',
            cwd: d.cwd || '',
            updatedAt: d.updatedAt || '',
            messageCount: msgs.length,
            file: path.join(dir, file)
          });
        } catch (_) {}
      }
    }
  } catch (_) {}
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

// Load a thread's messages for display in the transcript.
function readThread(id) {
  const all = listThreads();
  const t = all.find(x => x.id === id);
  if (!t) return null;
  try {
    const d = JSON.parse(fs.readFileSync(t.file, 'utf8'));
    const messages = (d.recentMessages || [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map(m => ({ role: m.role, text: m.text }));
    return { id: t.id, title: t.title, cwd: t.cwd, messages };
  } catch (_) { return null; }
}

// Delete a thread file. Returns true if something was removed.
function deleteThread(id) {
  const all = listThreads();
  const t = all.find(x => x.id === id);
  if (!t) return false;
  try { fs.unlinkSync(t.file); return true; } catch (_) { return false; }
}

// ---------- Additional CLI readers ----------

// Run an arbitrary CLI command and return its combined text output. Used for
// read-only commands and for slash commands driven through `perch run`.
function runRaw(args, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    let child;
    try { child = spawnPerch(args, opts.cwd || getSettings().cwd); }
    catch (e) { resolve({ ok: false, raw: e.message }); return; }
    let out = '', err = '';
    child.stdout.on('data', c => { out += c.toString(); });
    child.stderr.on('data', c => { err += c.toString(); });
    child.on('error', e => resolve({ ok: false, raw: e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code, raw: (out || err).trim() }));
  });
}

// Usage is an interactive slash command in v2.4.140 (`perch usage` is unknown).
// Driving it through one-shot `run --json` returns real allowance data.
function getUsage() {
  return new Promise((resolve) => {
    let child;
    try { child = spawnPerch(['run', '/usage', '--json', '--cwd', getSettings().cwd, '--mode', 'ask'], getSettings().cwd); }
    catch (e) { resolve({ ok: false, raw: e.message }); return; }
    let out = '', err = '';
    child.stdout.on('data', c => { out += c.toString(); });
    child.stderr.on('data', c => { err += c.toString(); });
    child.on('error', e => resolve({ ok: false, raw: e.message }));
    child.on('close', () => {
      try {
        const start = out.indexOf('{');
        const d = JSON.parse(start >= 0 ? out.slice(start) : out);
        resolve({ ok: d.ok !== false, text: d.assistantText || d.raw || '', raw: out });
      } catch (_) {
        resolve({ ok: false, text: (out || err).slice(0, 600), raw: out });
      }
    });
  });
}

// Parse `perch skills` into a simple [{id, description, scope}] list.
// Format is a "- <id>" line (optionally "  [personal]") followed by an
// indented description line on the next row.
async function listSkills() {
  const r = await runRaw(['skills']);
  const out = [];
  let section = '';
  let pending = null;
  const flush = () => { if (pending) { out.push(pending); pending = null; } };
  for (const line of r.raw.split(/\r?\n/)) {
    if (/^Built-in skills/i.test(line)) { flush(); section = 'built-in'; continue; }
    if (/^Your skills/i.test(line)) { flush(); section = 'user'; continue; }
    const nameLine = line.match(/^-\s+([A-Za-z0-9_.:-]+)\s*(.*)$/);
    if (nameLine && nameLine[1] !== 'name') {
      flush();
      pending = { id: nameLine[1].trim(), description: '', scope: section };
      continue;
    }
    if (pending && /^\s{2,}\S/.test(line)) {
      pending.description = (pending.description ? pending.description + ' ' : '') + line.trim();
    } else if (pending && line.trim() === '') {
      flush();
    }
  }
  flush();
  return out;
}

// Read-only routing status for the account area.
async function getRouting() {
  const [byok, byolm] = await Promise.all([
    runRaw(['byok', 'status']),
    runRaw(['byolm', 'status'])
  ]);
  const cloudActive = /cloud key:\s*(?!not in use)/i.test(byok.raw) && !/not in use/i.test(byok.raw.split('\n')[0] || '');
  const localActive = /local model:\s*(?!not configured)/i.test(byolm.raw) && !/not configured/i.test(byolm.raw.split('\n')[0] || '');
  let mode = 'Roost (Perch)';
  if (localActive) mode = 'Local model';
  else if (cloudActive) mode = 'Cloud key (BYOK)';
  return { mode, byok: byok.raw, byolm: byolm.raw };
}

module.exports = {
  runTurn, getSettings, resolvePerchPath, progressFromResult, checkStatus, login, logout,
  listThreads, readThread, deleteThread, runRaw, getUsage, listSkills, getRouting
};
