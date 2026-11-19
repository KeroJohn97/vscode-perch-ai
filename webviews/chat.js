const { baseStyles, themeScript, codiconLink, renderIcons, esc } = require('./shared');

// Live chat UI backed by the Perch CLI. The CLI buffers JSON until the run
// finishes, so the UI shows an honest "working" state with elapsed time, then
// renders the answer and a collapsible step list. No mock replies.

// Defined in Node (normal JS escaping) and injected via toString() so its
// regex backslashes survive the outer HTML template literal untouched.
function webviewMarkdown(src) {
  function e(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  let s = e(src);
  const blocks = [];
  s = s.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    blocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
    return '\u0000B' + (blocks.length - 1) + '\u0000';
  });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
       .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
       .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, '<ul>$&</ul>');
  s = s.split(/\n{2,}/).map(p => {
    if (/^<(h[1-3]|ul|pre)/.test(p.trim())) return p;
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
  s = s.replace(/\u0000B(\d+)\u0000/g, (_m, i) => blocks[+i]);
  return s;
}

function getHtml(webview, extensionUri, codiconUri) {
  const nonce = 'ag' + Math.random().toString(36).slice(2, 10);

  return renderIcons(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<title>PerchAI</title>
${codiconLink(codiconUri)}
<style>
${baseStyles()}
body { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--p-bg); color: var(--p-text); }

/* Header */
.header {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border-bottom: 1px solid var(--p-border); background: var(--p-bg);
}
.brand { display: flex; align-items: center; font-weight: 600; font-size: 13px; }
.icon-btn {
  background: transparent; color: var(--p-text-dim); border: none; border-radius: 6px;
  padding: 5px; display: flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: var(--p-bg-raised); color: var(--p-text); }
.header .spacer { flex: 1; }
.account-btn {
  display: inline-flex; align-items: center; gap: 6px; max-width: 170px;
  background: transparent; color: var(--p-text-dim); border: 1px solid var(--p-border);
  border-radius: 14px; padding: 3px 9px; font-size: 11px; cursor: pointer;
}
.account-btn:hover { border-color: var(--p-gold); color: var(--p-text); }
.account-btn .email { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
.account-btn .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--p-green); flex: 0 0 auto; }
.account-btn .dot.off { background: var(--p-orange); }

/* Account popover */
.popover {
  display: none; position: absolute; top: 44px; right: 10px; z-index: 20;
  width: 250px; background: var(--p-bg-input); border: 1px solid var(--p-border-strong);
  border-radius: 10px; padding: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.45);
}
.popover.open { display: block; }
.popover .p-head { font-size: 12px; font-weight: 600; color: var(--p-text); margin-bottom: 3px; }
.popover .p-sub { font-size: 11px; color: var(--p-text-dim); line-height: 1.5; margin-bottom: 10px; word-break: break-all; }
.popover .p-sub .signed { color: var(--p-green); }
.popover .p-sub .out { color: var(--p-orange); }
.popover .p-row { display: flex; gap: 6px; margin-top: 7px; }
.pop-btn {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  background: var(--p-bg-raised); color: var(--p-text); border: 1px solid var(--p-border-strong);
  border-radius: 7px; padding: 6px 8px; font-size: 11px; cursor: pointer;
}
.pop-btn:hover { border-color: var(--p-gold); }
.pop-btn.primary { background: var(--p-gold); color: #1a1613; border-color: var(--p-gold); font-weight: 600; }
.pop-btn:disabled { opacity: .5; cursor: default; }
.popover .p-msg { font-size: 10.5px; margin-top: 9px; line-height: 1.5; }
.popover .p-msg.ok { color: var(--p-green); }
.popover .p-msg.bad { color: var(--p-orange); }
.popover .p-note { font-size: 10px; color: var(--p-text-faint); margin-top: 10px; line-height: 1.5; border-top: 1px solid var(--p-border); padding-top: 8px; }

/* Working-folder bar */
.folder-bar {
  flex: 0 0 auto; display: flex; align-items: center; gap: 7px;
  padding: 6px 12px; border-bottom: 1px solid var(--p-border);
  background: var(--p-bg-raised); font-size: 11px; color: var(--p-text-dim);
}
.folder-btn {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  background: transparent; color: var(--p-text); border: 1px solid var(--p-border-strong);
  border-radius: 6px; padding: 2px 7px; font-size: 11px; cursor: pointer;
}
.folder-btn:hover { border-color: var(--p-gold); }
.folder-btn .name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--p-green); flex: 0 0 auto; }
.status-dot.off { background: var(--p-orange); }

/* Transcript */
.transcript { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 20px 16px 28px; }
.thread { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.empty { max-width: 720px; margin: 36px auto; }
.empty .hero { text-align: center; margin-bottom: 26px; }
.empty h2 { font-size: 16px; color: var(--p-text); margin: 0 0 6px; font-weight: 600; }
.empty p { font-size: 12px; color: var(--p-text-faint); margin: 0; line-height: 1.6; }
.examples-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: var(--p-text-faint); margin: 0 0 8px; }
.examples { display: flex; flex-direction: column; gap: 7px; }
.example {
  display: flex; align-items: center; gap: 9px; text-align: left; width: 100%;
  background: var(--p-bg-raised); color: var(--p-text-dim);
  border: 1px solid var(--p-border); border-radius: 9px; padding: 10px 12px;
  font-size: 12px; cursor: pointer;
}
.example:hover { border-color: var(--p-gold); color: var(--p-text); }
.example .codicon { color: var(--p-gold); flex: 0 0 auto; }

/* Turns */
.turn.user { display: flex; justify-content: flex-end; }
.user-bubble {
  max-width: 92%; background: var(--p-bg-raised); border: 1px solid var(--p-border-strong);
  border-radius: 10px; padding: 9px 12px; color: var(--p-text); font-size: 12.5px;
  white-space: pre-wrap; word-break: break-word;
}
.turn.assistant { display: flex; align-items: flex-start; }
.assistant-body { flex: 1; min-width: 0; }
.answer { font-size: 12.5px; line-height: 1.65; color: var(--p-text); word-break: break-word; }
.answer p { margin: 0 0 10px; }
.answer p:last-child { margin-bottom: 0; }
.answer h1, .answer h2, .answer h3 { font-size: 13px; margin: 14px 0 6px; color: var(--p-text); }
.answer ul, .answer ol { margin: 6px 0 10px; padding-left: 20px; }
.answer li { margin: 3px 0; }
.answer code { font-family: var(--ag-code-font); font-size: 11.5px; background: var(--p-bg-raised); border: 1px solid var(--p-border); border-radius: 4px; padding: 1px 4px; color: var(--p-orange); }
.answer pre { background: var(--p-bg-raised); border: 1px solid var(--p-border); border-radius: 8px; padding: 10px 12px; overflow-x: auto; margin: 8px 0 12px; }
.answer pre code { background: none; border: none; padding: 0; color: var(--p-orange); white-space: pre; }
.answer strong { color: var(--p-text); }
.answer a { color: var(--p-gold); }
.answer blockquote { border-left: 2px solid var(--p-border-strong); margin: 8px 0; padding: 2px 10px; color: var(--p-text-dim); }

/* Working state */
.working { display: flex; align-items: center; gap: 9px; color: var(--p-orange); font-size: 12px; }
.spinner {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid var(--p-border-strong); border-top-color: var(--p-orange);
  animation: spin .8s linear infinite; flex: 0 0 auto;
}
@keyframes spin { to { transform: rotate(360deg); } }
.working .elapsed { color: var(--p-text-faint); font-variant-numeric: tabular-nums; }

/* Workspace changes panel */
.changes-panel {
  margin: 10px 0 0; border: 1px solid var(--p-border-strong); border-radius: 9px;
  background: var(--p-bg-raised); overflow: hidden;
}
.changes-head {
  display: flex; align-items: center; gap: 7px; padding: 8px 10px;
  font-size: 11.5px; color: var(--p-text); font-weight: 600;
  border-bottom: 1px solid var(--p-border);
}
.changes-head .codicon { color: var(--p-gold); }
.changes-head .spacer { flex: 1; }
.changes-head .src { font-size: 10px; color: var(--p-text-faint); font-weight: 400; }
.changes-list { max-height: 170px; overflow-y: auto; padding: 5px 8px; }
.change-row { display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 11.5px; }
.change-row .codicon { flex: 0 0 auto; }
.change-row .cp { flex: 1; min-width: 0; color: var(--p-text); word-break: break-all; }
.change-row .cs { font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
.cs.modified { color: var(--p-orange); }
.cs.added { color: var(--p-green); }
.cs.deleted { color: var(--p-red); }
.change-row.clickable { cursor: pointer; }
.change-row.clickable:hover .cp { color: var(--p-gold); }
.change-row .chev { color: var(--p-text-faint); display: flex; font-size: 11px; transition: transform .12s ease; }
.change-row.expanded .chev { transform: rotate(90deg); }
.diff-box {
  display: none; margin: 2px 6px 8px; border: 1px solid var(--p-border);
  border-radius: 7px; background: var(--p-bg); max-height: 260px; overflow: auto;
  font-family: var(--ag-code-font); font-size: 11px; line-height: 1.5;
}
.diff-box.open { display: block; }
.diff-row { display: flex; white-space: pre; padding: 0 8px; }
.diff-row .sign { width: 12px; flex: 0 0 auto; user-select: none; opacity: .7; }
.diff-row.add { background: rgba(129,201,149,.1); color: var(--p-green); }
.diff-row.del { background: rgba(242,139,130,.1); color: var(--p-red); }
.diff-row.ctx { color: var(--p-text-dim); }
.diff-row.hunk { color: var(--p-gold); background: rgba(193,159,106,.08); }
.diff-loading { padding: 8px; color: var(--p-text-faint); }
.changes-actions { display: flex; gap: 7px; padding: 8px 10px; border-top: 1px solid var(--p-border); }
.changes-actions .mini-btn.accept { color: var(--p-green); border-color: var(--p-green); }
.changes-actions .mini-btn.reject { color: var(--p-orange); border-color: var(--p-orange); }

/* Steps + actions */
.steps { margin-top: 10px; }
.steps summary { cursor: pointer; font-size: 11px; color: var(--p-text-dim); list-style: none; display: flex; align-items: center; gap: 5px; }
.steps summary::-webkit-details-marker { display: none; }
.steps[open] summary .codicon { transform: rotate(90deg); }
.step-list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.step-row { display: flex; gap: 7px; font-size: 11px; }
.step-row .codicon { color: var(--p-green); flex: 0 0 auto; margin-top: 1px; }
.step-row .t { color: var(--p-text-dim); }
.step-row .x { color: var(--p-text-faint); margin-top: 1px; white-space: pre-wrap; word-break: break-word; }
.msg-actions { display: flex; gap: 6px; margin-top: 10px; }
.mini-btn {
  display: inline-flex; align-items: center; gap: 4px; background: transparent;
  color: var(--p-text-faint); border: 1px solid var(--p-border); border-radius: 6px;
  padding: 3px 8px; font-size: 10.5px; cursor: pointer;
}
.mini-btn:hover { color: var(--p-text); border-color: var(--p-border-strong); }
.turn.error { border-left: 2px solid var(--p-orange); padding: 8px 11px; color: var(--p-orange); font-size: 12px; white-space: pre-wrap; background: rgba(217,154,91,.06); border-radius: 0 8px 8px 0; }

/* Composer */
.composer { flex: 0 0 auto; padding: 10px 16px 12px; background: var(--p-bg); }
.composer-inner {
  max-width: 720px; margin: 0 auto; background: var(--p-bg-input);
  border: 1px solid var(--p-border-strong); border-radius: 12px; padding: 10px 12px 8px;
}
.composer-inner:focus-within { border-color: var(--p-gold); }
.composer textarea {
  width: 100%; resize: none; border: none; outline: none; background: transparent;
  color: var(--p-text); font-family: inherit; font-size: 13px; line-height: 1.5;
  min-height: 30px; max-height: 140px; padding: 2px 0;
}
.composer textarea::placeholder { color: var(--p-text-faint); }
.composer-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.icon-btn.on { color: var(--p-gold); background: var(--p-bg-raised); }
.attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.attachments:empty { display: none; }
.attach-chip {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  background: rgba(193,159,106,.1); border: 1px solid var(--p-border-strong);
  border-radius: 6px; padding: 3px 6px; font-size: 10.5px; color: var(--p-text);
}
.attach-chip .n { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attach-chip .x { cursor: pointer; color: var(--p-text-faint); display: flex; }
.attach-chip .x:hover { color: var(--p-orange); }
.image-warning {
  display: none; margin-top: 8px; padding: 8px 10px; border-radius: 8px;
  background: rgba(217,154,91,.1); border: 1px solid var(--p-orange);
  color: var(--p-orange); font-size: 11px; line-height: 1.5;
}
.image-warning.show { display: block; }

/* Drag & drop overlay */
.drop-overlay {
  display: none; position: fixed; inset: 0; z-index: 100;
  background: rgba(26,22,19,.88); border: 2px dashed var(--p-gold);
  border-radius: 10px; align-items: center; justify-content: center; flex-direction: column;
  gap: 10px; pointer-events: none;
}
.drop-overlay.show { display: flex; }
.drop-overlay .codicon { font-size: 34px; color: var(--p-gold); }
.drop-overlay .dt { font-size: 13px; font-weight: 600; color: var(--p-text); }
.drop-overlay .ds { font-size: 11px; color: var(--p-text-faint); }
.options {
  display: none; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding-top: 8px;
  border-top: 1px solid var(--p-border);
}
.options.open { display: flex; }
.chip {
  display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--p-border);
  border-radius: 7px; background: var(--p-bg-raised); color: var(--p-text-dim);
  font-size: 11px; padding: 3px 7px; white-space: nowrap;
}
.chip .codicon { font-size: 11px; }

/* Custom themed dropdowns (native <select> popups ignore the webview theme). */
.dropdown { position: relative; }
.dd-trigger {
  display: inline-flex; align-items: center; gap: 4px; background: transparent;
  color: inherit; border: none; outline: none; font: inherit; cursor: pointer; padding: 0;
}
.dd-trigger .dd-value { color: var(--p-text); }
.dd-trigger .codicon.dd-chev { font-size: 10px; color: var(--p-text-faint); transition: transform .12s ease; }
.dropdown.open .dd-trigger .codicon.dd-chev { transform: rotate(180deg); }
.dd-menu {
  display: none; position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 30;
  min-width: 150px; background: var(--p-bg-input); border: 1px solid var(--p-border-strong);
  border-radius: 8px; padding: 4px; box-shadow: 0 8px 26px rgba(0,0,0,.5);
}
.dropdown.open .dd-menu { display: block; }
.dd-item {
  display: flex; align-items: center; gap: 7px; width: 100%; text-align: left;
  background: transparent; color: var(--p-text-dim); border: none; border-radius: 5px;
  padding: 6px 8px; font-size: 11.5px; cursor: pointer;
}
.dd-item:hover { background: var(--p-bg-raised); color: var(--p-text); }
.dd-item.selected { color: var(--p-gold); }
.dd-item .dd-check { margin-left: auto; color: var(--p-gold); visibility: hidden; display: flex; }
.dd-item.selected .dd-check { visibility: visible; }
.send-btn {
  margin-left: auto; width: 28px; height: 28px; border-radius: 7px; background: var(--p-gold);
  color: #1a1613; border: none; display: flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
.send-btn:hover { filter: brightness(1.08); }
.send-btn:disabled { opacity: .45; cursor: default; }
.send-btn.stop { background: var(--p-orange); }
.send-btn .codicon { font-size: 14px; }
.hint { max-width: 720px; margin: 7px auto 0; text-align: center; font-size: 10.5px; color: var(--p-text-faint); }
</style>
</head>
<body>
<div class="drop-overlay" id="dropOverlay">
  <span class="codicon codicon-cloud-upload"></span>
  <span class="dt">Drop files or images to attach</span>
  <span class="ds">They'll be added as context for your next message</span>
</div>
<div class="header">
  <span class="brand">PerchAI</span>
  <span class="spacer"></span>
  <button class="icon-btn" id="undoBtn" title="Undo last file changes in this conversation">$(discard)</button>
  <button class="icon-btn" id="openInWindowBtn" title="Open conversation in a window">$(link-external)</button>
  <button class="icon-btn" id="historyBtn" title="Conversation history">$(history)</button>
  <button class="account-btn" id="accountBtn" title="Manage Perch account">
    <span class="dot off" id="accountDot"></span><span class="email" id="accountEmail">Account</span> $(account)
  </button>
</div>
<div class="folder-bar">
  <span class="status-dot" id="statusDot" title="Perch CLI status"></span>
  <span id="statusText">Checking Perch CLI…</span>
  <span class="spacer"></span>
  <button class="folder-btn" id="folderBtn" title="Choose the folder Perch works in">$(folder) <span class="name" id="folderName">…</span> $(chevron-down)</button>
</div>
<div class="transcript" id="transcript">
  <div class="thread" id="thread">
    <div class="empty" id="empty">
      <div class="hero">
        <h2>What can I help with?</h2>
        <p>Real Perch turns in your workspace. Ask a question or describe a task.</p>
      </div>
      <div class="examples-label">Try one of these</div>
      <div class="examples">
        <button class="example" data-prompt="List the files in this folder and explain the project structure.">$(folder-opened) Explain this project's structure</button>
        <button class="example" data-prompt="Find any TODO comments in this workspace and summarize them.">$(search) Find all TODOs in the workspace</button>
        <button class="example" data-prompt="What does the main entry point of this project do?">$(file-code) Explain the main entry point</button>
      </div>
    </div>
  </div>
</div>
<div class="composer">
  <div class="composer-inner">
    <textarea id="prompt" rows="2" placeholder="Ask anything, or describe a task…"></textarea>
    <div class="attachments" id="attachments"></div>
    <div class="image-warning" id="imageWarning">Images can't be read by the Perch CLI here (its vision helper fails in this environment). Open the image in Perch Desktop for image questions, or reattach as text/PDF.</div>
    <div class="composer-row">
      <button class="icon-btn" id="attachBtn" title="Attach files">$(file-add)</button>
      <button class="icon-btn" id="skillBtn" title="Choose a skill">$(symbol-method)</button>
      <button class="icon-btn" id="optionsBtn" title="Model, effort, persona, permissions">$(settings-gear)</button>
      <button class="send-btn" id="send" title="Send">$(arrow-up)</button>
    </div>
    <div class="options" id="options">
      <span class="chip">$(symbol-color)
        <span class="dropdown" id="ddModel">
          <button class="dd-trigger" type="button"><span class="dd-value">Roost (auto)</span>$(chevron-down)</button>
          <span class="dd-menu">
            <button class="dd-item selected" type="button" data-value="">Roost (auto)<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="standard">Standard<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="standard 1m">Standard 1M<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="pro">Pro<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="pro 1m">Pro 1M<span class="dd-check">$(check)</span></button>
          </span>
        </span>
      </span>
      <span class="chip">$(comment-discussion)
        <span class="dropdown" id="ddMode">
          <button class="dd-trigger" type="button"><span class="dd-value">Agents</span>$(chevron-down)</button>
          <span class="dd-menu">
            <button class="dd-item selected" type="button" data-value="agents">Agents<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="ask">Ask<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="plan">Plan<span class="dd-check">$(check)</span></button>
          </span>
        </span>
      </span>
      <span class="chip">$(shield)
        <span class="dropdown" id="ddPermission">
          <button class="dd-trigger" type="button"><span class="dd-value">Auto Review</span>$(chevron-down)</button>
          <span class="dd-menu">
            <button class="dd-item selected" type="button" data-value="auto_review">Auto Review<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="take_the_wheel">Take the Wheel<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="default">Default (needs approval)<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="plan">Plan (read-only)<span class="dd-check">$(check)</span></button>
          </span>
        </span>
      </span>
      <span class="chip">$(lightbulb)
        <span class="dropdown" id="ddEffort">
          <button class="dd-trigger" type="button"><span class="dd-value">Auto</span>$(chevron-down)</button>
          <span class="dd-menu">
            <button class="dd-item selected" type="button" data-value="">Auto<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="off">Off<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="low">Low<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="medium">Medium<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="high">High<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="xhigh">XHigh<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="max">Max<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="ultra">Ultra<span class="dd-check">$(check)</span></button>
          </span>
        </span>
      </span>
      <span class="chip">$(person)
        <span class="dropdown" id="ddPersona">
          <button class="dd-trigger" type="button"><span class="dd-value">Auto</span>$(chevron-down)</button>
          <span class="dd-menu">
            <button class="dd-item selected" type="button" data-value="">Auto<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="saffron">Saffron<span class="dd-check">$(check)</span></button>
            <button class="dd-item" type="button" data-value="quill">Quill<span class="dd-check">$(check)</span></button>
          </span>
        </span>
      </span>
    </div>
  </div>
  <div class="hint">Enter to send · Shift+Enter new line · ↑/↓ history · paperclip to attach · gear for options</div>
</div>
<script nonce="${nonce}">
${themeScript()}
const vscode = acquireVsCodeApi();
const md = ${webviewMarkdown.toString()};
const thread = document.getElementById('thread');
const transcript = document.getElementById('transcript');
const prompt = document.getElementById('prompt');
const sendBtn = document.getElementById('send');
const empty = document.getElementById('empty');
let busy = false;
let activeWorking = null;
let timer = null;
let startedAt = 0;
let attachments = [];   // {path, name}
let activeSkills = [];  // skill ids for the next run
// Prompt history navigation (terminal-style Up/Down).
let promptHistory = [];   // oldest -> newest, from extension host
let historyIndex = -1;    // -1 = editing a fresh draft
let historyDraft = '';    // preserved draft when navigating back up

function scroll() { transcript.scrollTop = transcript.scrollHeight; }
function hideEmpty() { if (empty && empty.isConnected) empty.remove(); }

// md() is injected from webviewMarkdown() above.

function addUser(text) {
  hideEmpty();
  const el = document.createElement('div');
  el.className = 'turn user';
  const bubble = document.createElement('div');
  bubble.className = 'user-bubble';
  bubble.textContent = text;
  el.appendChild(bubble);
  thread.appendChild(el);
  scroll();
}

function addWorking() {
  hideEmpty();
  const el = document.createElement('div');
  el.className = 'turn assistant';
  el.innerHTML = '<div class="assistant-body"><div class="working"><span class="spinner"></span><span>Working…</span><span class="elapsed">0s</span></div></div>';
  thread.appendChild(el);
  scroll();
  return el;
}

function finishWorking(node, text, progress, durationMs) {
  const body = node.querySelector('.assistant-body');
  body.innerHTML = '';
  const answer = document.createElement('div');
  answer.className = 'answer';
  answer.innerHTML = md(text || '(no answer)');
  body.appendChild(answer);
  if (progress && progress.length) {
    const det = document.createElement('details');
    det.className = 'steps';
    det.innerHTML = '<summary>$(chevron-right) ' + progress.length + ' step' + (progress.length === 1 ? '' : 's') + '</summary><div class="step-list"></div>';
    const list = det.querySelector('.step-list');
    for (const p of progress) {
      const row = document.createElement('div');
      row.className = 'step-row';
      row.innerHTML = '<span class="codicon codicon-check"></span><div><div class="t"></div><div class="x"></div></div>';
      row.querySelector('.t').textContent = p.title || p.kind || 'Step';
      row.querySelector('.x').textContent = (p.text || '').slice(0, 240);
      list.appendChild(row);
    }
    body.appendChild(det);
  }
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.innerHTML = '<button class="mini-btn">' + '$(copy) Copy' + '</button>' +
    (durationMs ? '<span class="mini-btn" style="cursor:default">' + (durationMs / 1000).toFixed(1) + 's</span>' : '');
  actions.querySelector('button').addEventListener('click', () => {
    const ta = document.createElement('textarea');
    ta.value = text || '';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
    const b = actions.querySelector('button');
    b.textContent = 'Copied'; setTimeout(() => { b.innerHTML = '$(copy) Copy'; }, 1200);
  });
  body.appendChild(actions);
  scroll();
}

function addError(message) {
  hideEmpty();
  const el = document.createElement('div');
  el.className = 'turn error';
  el.textContent = message;
  thread.appendChild(el);
  scroll();
}

// Show the optional workspace-changes panel with Accept/Reject.
let lastChangesPanel = null;
const pendingDiffs = {}; // path -> diff box element awaiting host response
function showWorkspaceChanges(files, git) {
  hideEmpty();
  const panel = document.createElement('div');
  panel.className = 'changes-panel';
  const icon = git ? 'source-control' : 'file-code';
  panel.innerHTML =
    '<div class="changes-head"><span class="codicon codicon-' + icon + '"></span>' +
    '<span>' + files.length + ' changed file' + (files.length === 1 ? '' : 's') + '</span>' +
    '<span class="spacer"></span><span class="src">' + (git ? 'git status' : 'workspace snapshot') + '</span></div>' +
    '<div class="changes-list"></div>' +
    '<div class="changes-actions">' +
      '<button class="mini-btn accept">$(check) Accept</button>' +
      '<button class="mini-btn reject">$(discard) Reject</button>' +
    '</div>';
  const list = panel.querySelector('.changes-list');
  for (const f of files) {
    const st = f.status || 'modified';
    const ic = st === 'added' ? 'new-file' : st === 'deleted' ? 'trash' : 'edit';
    const row = document.createElement('div');
    row.className = 'change-row clickable';
    row.innerHTML = '<span class="codicon codicon-chevron-right chev"></span>' +
      '<span class="codicon codicon-' + ic + '"></span>' +
      '<span class="cp"></span><span class="cs ' + st + '">' + st + '</span>';
    row.querySelector('.cp').textContent = f.path;
    const diffBox = document.createElement('div');
    diffBox.className = 'diff-box';
    list.appendChild(row);
    list.appendChild(diffBox);
    row.addEventListener('click', () => {
      const open = !diffBox.classList.contains('open');
      diffBox.classList.toggle('open', open);
      row.classList.toggle('expanded', open);
      if (open && !diffBox.dataset.loaded) {
        diffBox.dataset.loaded = '1';
        diffBox.innerHTML = '<div class="diff-loading">Loading diff…</div>';
        pendingDiffs[f.path] = diffBox;
        vscode.postMessage({ type: 'viewChange', path: f.path });
      }
    });
  }
  panel.querySelector('.accept').addEventListener('click', () => {
    vscode.postMessage({ type: 'acceptChanges' });
  });
  panel.querySelector('.reject').addEventListener('click', () => {
    vscode.postMessage({ type: 'rejectChanges' });
  });
  if (lastChangesPanel && lastChangesPanel.isConnected) lastChangesPanel.remove();
  thread.appendChild(panel);
  lastChangesPanel = panel;
  scroll();
}

function setBusy(value) {
  busy = value;
  sendBtn.classList.toggle('stop', value);
  sendBtn.title = value ? 'Stop' : 'Send';
  sendBtn.innerHTML = value ? '$(stop)' : '$(arrow-up)';
  if (value) {
    startedAt = Date.now();
    timer = setInterval(() => {
      if (activeWorking) {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        activeWorking.querySelector('.elapsed').textContent = s + 's';
      }
    }, 500);
  } else if (timer) { clearInterval(timer); timer = null; }
}

function send(textOverride) {
  if (busy) { vscode.postMessage({ type: 'stop' }); return; }
  const text = (textOverride || prompt.value).trim();
  if (!text) return;
  addUser(text);
  prompt.value = '';
  activeWorking = addWorking();
  setBusy(true);
  vscode.postMessage({
    type: 'send', text,
    mode: ddValue('ddMode'),
    permission: ddValue('ddPermission'),
    model: ddValue('ddModel') || undefined,
    effort: ddValue('ddEffort') || undefined,
    persona: ddValue('ddPersona') || undefined,
    attachments: attachments.map(a => a.path),
    skills: activeSkills.slice()
  });
  attachments = [];
  renderAttachments();
  updateSkillBtn();
  historyIndex = -1;
  historyDraft = '';
}

// Read the selected value of a custom dropdown.
function ddValue(id) {
  const el = document.getElementById(id);
  const sel = el && el.querySelector('.dd-item.selected');
  return sel ? sel.dataset.value : '';
}

// Wire all custom dropdowns: toggle menu, select item, close on outside click.
function initDropdown(id) {
  const root = document.getElementById(id);
  if (!root) return;
  root.querySelector('.dd-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = root.classList.contains('open');
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) root.classList.add('open');
  });
  root.querySelectorAll('.dd-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      root.querySelectorAll('.dd-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      root.querySelector('.dd-value').textContent = item.textContent.trim();
      root.classList.remove('open');
    });
  });
}
['ddModel', 'ddMode', 'ddPermission', 'ddEffort', 'ddPersona'].forEach(initDropdown);

// Attachment chips.
function isImageName(n) {
  const lower = String(n || '').toLowerCase();
  return ['png','jpg','jpeg','gif','webp','bmp','tif','tiff','heic','svg']
    .some(ext => lower.endsWith('.' + ext));
}
function renderAttachments() {
  const box = document.getElementById('attachments');
  box.innerHTML = '';
  const hasImage = attachments.some(a => isImageName(a.name) || String(a.mime || '').startsWith('image/'));
  document.getElementById('imageWarning').classList.toggle('show', hasImage);
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    chip.innerHTML = '<span class="codicon codicon-file"></span><span class="n"></span><span class="x"><span class="codicon codicon-close"></span></span>';
    chip.querySelector('.n').textContent = a.name;
    chip.querySelector('.x').addEventListener('click', () => {
      attachments.splice(i, 1);
      renderAttachments();
    });
    box.appendChild(chip);
  }
}
function updateSkillBtn() {
  const btn = document.getElementById('skillBtn');
  if (activeSkills.length) { btn.classList.add('on'); btn.title = 'Skills: ' + activeSkills.join(', '); }
  else { btn.classList.remove('on'); btn.title = 'Choose a skill'; }
}

// --- Drag & drop attachments ---
// Webviews cannot see real filesystem paths of dropped files, so read each
// File as base64 and let the extension host write it to a temp file.
const dropOverlay = document.getElementById('dropOverlay');
let dragDepth = 0;

function hasFiles(e) {
  return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
}
function showDrop(on) {
  dropOverlay.classList.toggle('show', !!on);
}
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  showDrop(true);
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  showDrop(true);
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) showDrop(false);
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  showDrop(false);
  const files = Array.from(e.dataTransfer.files || []);
  if (!files.length) return;
  Promise.all(files.map(file => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name || 'dropped-file',
      mime: file.type || '',
      data: String(reader.result || '').split(',').pop() // strip data:...;base64,
    });
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  }))).then(items => {
    const good = items.filter(Boolean);
    if (good.length) vscode.postMessage({ type: 'droppedFiles', files: good });
  });
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

sendBtn.addEventListener('click', () => send());

// Navigate the user's prompt history with Up/Down while the composer is focused.
// Only intercept Up on the first line and Down on the last line, so normal
// multi-line cursor movement still works via the arrow keys.
const NL = String.fromCharCode(10); // newline without a backslash escape in this template
function atFirstLine() {
  return prompt.value.slice(0, prompt.selectionStart).indexOf(NL) === -1;
}
function atLastLine() {
  return prompt.value.indexOf(NL, prompt.selectionEnd) === -1;
}
function setPromptValue(v) {
  prompt.value = v;
  const end = v.length;
  prompt.setSelectionRange(end, end);
}

function navigateHistory(direction) {
  if (!promptHistory.length) return false;
  if (direction === 'up') {
    if (historyIndex === -1) historyDraft = prompt.value; // save current draft once
    if (historyIndex < promptHistory.length - 1) {
      historyIndex++;
      setPromptValue(promptHistory[promptHistory.length - 1 - historyIndex]);
    }
    return true;
  }
  // down
  if (historyIndex > 0) {
    historyIndex--;
    setPromptValue(promptHistory[promptHistory.length - 1 - historyIndex]);
  } else if (historyIndex === 0) {
    historyIndex = -1;
    setPromptValue(historyDraft); // restore the draft we started from
  }
  return true;
}

prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
  if (e.key === 'ArrowUp' && atFirstLine() && promptHistory.length) {
    e.preventDefault(); navigateHistory('up'); return;
  }
  if (e.key === 'ArrowDown' && atLastLine() && historyIndex >= 0) {
    e.preventDefault(); navigateHistory('down'); return;
  }
});
document.getElementById('optionsBtn').addEventListener('click', () => {
  document.getElementById('options').classList.toggle('open');
});
document.getElementById('attachBtn').addEventListener('click', () => vscode.postMessage({ type: 'attachFiles' }));
document.getElementById('skillBtn').addEventListener('click', () => vscode.postMessage({ type: 'chooseSkill' }));

// History and account both use native VS Code Quick Picks.
document.getElementById('undoBtn').addEventListener('click', () => vscode.postMessage({ type: 'undo' }));
document.getElementById('openInWindowBtn').addEventListener('click', () => vscode.postMessage({ type: 'openInWindow' }));
document.getElementById('historyBtn').addEventListener('click', () => vscode.postMessage({ type: 'openHistory' }));
document.getElementById('accountBtn').addEventListener('click', () => vscode.postMessage({ type: 'manageAccount' }));
document.getElementById('folderBtn').addEventListener('click', () => vscode.postMessage({ type: 'chooseFolder' }));

function renderAccount(st) {
  const signedIn = !!(st && st.signedIn);
  document.getElementById('accountDot').classList.toggle('off', !signedIn);
  document.getElementById('accountEmail').textContent = signedIn ? (st.email || 'Signed in') : 'Sign in';
}
thread.addEventListener('click', (e) => {
  const ex = e.target.closest('[data-prompt]');
  if (ex) send(ex.dataset.prompt);
});

window.addEventListener('message', (event) => {
  const msg = event.data || {};
  switch (msg.type) {
    case 'promptHistory':
      promptHistory = Array.isArray(msg.history) ? msg.history : [];
      break;
    case 'status':
      document.getElementById('folderName').textContent = msg.cwdName || 'folder';
      document.getElementById('folderBtn').title = 'Working folder: ' + (msg.cwd || '');
      break;
    case 'threadLoaded': {
      // Replace the transcript with the loaded conversation.
      thread.innerHTML = '';
      for (const m of (msg.messages || [])) {
        if (m.role === 'user') {
          addUser(m.text);
        } else {
          const el = document.createElement('div');
          el.className = 'turn assistant';
          el.innerHTML = '<div class="assistant-body"><div class="answer"></div></div>';
          el.querySelector('.answer').innerHTML = md(m.text);
          thread.appendChild(el);
        }
      }
      if (!(msg.messages || []).length) {
        thread.innerHTML = '<div style="text-align:center;color:var(--p-text-faint);padding:30px;font-size:12px">This conversation has no messages.</div>';
      }
      scroll();
      break;
    }
    case 'cliStatus':
      document.getElementById('statusDot').classList.toggle('off', !msg.ok);
      document.getElementById('statusText').textContent = msg.ok
        ? 'Perch ready' + (msg.email ? ' · ' + msg.email : '') + (msg.version ? ' · v' + msg.version : '')
        : 'Perch CLI not signed in — click Account to sign in';
      renderAccount(msg);
      break;
    case 'sessionMeta':
      document.title = msg.title || 'PerchAI';
      break;
    case 'filesAttached':
      for (const f of (msg.files || [])) {
        if (!attachments.some(a => a.path === f.path)) attachments.push(f);
      }
      renderAttachments();
      break;
    case 'dropError':
      addError(msg.message || 'Could not attach the dropped file(s).');
      break;
    case 'skillChosen':
      activeSkills = msg.skills || [];
      updateSkillBtn();
      break;
    case 'workspaceChanges':
      showWorkspaceChanges(msg.files || [], !!msg.git);
      break;
    case 'changeDiff': {
      const box = pendingDiffs[msg.path];
      if (box) {
        box.innerHTML = '';
        for (const r of (msg.rows || [])) {
          const line = document.createElement('div');
          line.className = 'diff-row ' + (r.type || 'ctx');
          const sign = r.type === 'add' ? '+' : r.type === 'del' ? '-' : r.type === 'hunk' ? '@' : ' ';
          const s = document.createElement('span');
          s.className = 'sign'; s.textContent = sign;
          const t = document.createElement('span');
          t.textContent = r.text;
          line.appendChild(s); line.appendChild(t);
          box.appendChild(line);
        }
        if (!(msg.rows || []).length) box.innerHTML = '<div class="diff-loading">No textual diff available.</div>';
        delete pendingDiffs[msg.path];
      }
      break;
    }
    case 'changesResolved':
      if (lastChangesPanel && lastChangesPanel.isConnected) lastChangesPanel.remove();
      lastChangesPanel = null;
      for (const k of Object.keys(pendingDiffs)) delete pendingDiffs[k];
      break;
    case 'runStart':
      setBusy(true);
      if (!activeWorking) activeWorking = addWorking();
      break;
    case 'runDone':
      if (activeWorking) finishWorking(activeWorking, msg.text, msg.progress, msg.durationMs);
      activeWorking = null;
      setBusy(false);
      break;
    case 'error':
      if (activeWorking) finishWorking(activeWorking, '', [], 0);
      addError(msg.message || 'Unknown error');
      activeWorking = null;
      setBusy(false);
      break;
    case 'stopped':
      if (activeWorking) finishWorking(activeWorking, (window._lastText || '') + NL + '[stopped]', [], 0);
      activeWorking = null;
      setBusy(false);
      break;
  }
});

// Tell the extension host that our listeners are ready. The host replies with
// the full initial state, so no startup message is lost to a load-order race.
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`);
}

module.exports = { getHtml };
