const { baseStyles, themeScript, codiconLink, renderIcons, esc } = require('./shared');

const ARTIFACT_DATA = {
  'plan-dark-mode': {
    kind: 'Implementation Plan',
    title: 'Dark mode toggle',
    subtitle: 'Add a persisted dark theme toggle to the settings page.',
    steps: [
      { title: 'Audit theme tokens', detail: 'Locate color variables in theme.css', file: 'src/theme.css', status: 'done' },
      { title: 'Define dark palette', detail: 'Add a [data-theme="dark"] token block', file: 'src/theme.css', status: 'done' },
      { title: 'Add toggle control', detail: 'Switch component in settings with localStorage persistence', file: 'src/SettingsPage.tsx', status: 'active' },
      { title: 'Update documentation', detail: 'Document the new setting in README', file: 'README.md', status: 'todo' }
    ]
  },
  'tasks-dark-mode': {
    kind: 'Task List',
    title: 'Dark mode implementation',
    subtitle: 'Live checklist of completed steps.',
    steps: [
      { title: 'Audit theme tokens', detail: 'Complete', file: 'src/theme.css', status: 'done' },
      { title: 'Define dark palette', detail: 'Complete', file: 'src/theme.css', status: 'done' },
      { title: 'Add toggle control', detail: 'Complete', file: 'src/SettingsPage.tsx', status: 'done' },
      { title: 'Update documentation', detail: 'Complete', file: 'README.md', status: 'done' }
    ]
  },
  'browser-rec': {
    kind: 'Browser Recording',
    title: 'Toggle verification',
    subtitle: 'Sandboxed Chrome run · 00:24 · 3 steps',
    steps: [
      { title: 'Load settings page', detail: 'http://localhost:3000/settings', file: '', status: 'done' },
      { title: 'Click theme toggle', detail: 'Assert data-theme attribute flips to dark', file: '', status: 'done' },
      { title: 'Capture screenshot', detail: 'Dark theme rendered correctly', file: '', status: 'done' }
    ]
  },
  walkthrough: {
    kind: 'Walkthrough',
    title: 'Theme architecture',
    subtitle: 'How theming is structured in this codebase.',
    steps: [
      { title: 'Token layer', detail: 'CSS custom properties in theme.css', file: 'src/theme.css', status: 'done' },
      { title: 'Provider', detail: 'ThemeProvider context in App.tsx', file: 'src/App.tsx', status: 'done' },
      { title: 'Consumer', detail: 'Components read tokens via CSS vars', file: '', status: 'done' },
      { title: 'Persistence', detail: 'localStorage key ag-theme', file: 'src/SettingsPage.tsx', status: 'done' },
      { title: 'Extension points', detail: 'Where to add future themes', file: '', status: 'done' }
    ]
  }
};

function stepHtml(s, i) {
  const icon = s.status === 'done' ? '$(check)' : s.status === 'active' ? '$(sync~spin)' : '$(circle-outline)';
  const cls = s.status;
  const file = s.file ? `<span class="file">$(file-code) ${esc(s.file)}</span>` : '';
  return `
    <div class="step ${cls}">
      <div class="step-icon">${icon}</div>
      <div class="step-body">
        <div class="step-title">${i + 1}. ${esc(s.title)}</div>
        <div class="step-detail muted">${esc(s.detail)}</div>
        ${file}
      </div>
    </div>`;
}

function getHtml(webview, extensionUri, artifactId, codiconUri) {
  const nonce = 'ag' + Math.random().toString(36).slice(2, 10);
  const data = ARTIFACT_DATA[artifactId] || ARTIFACT_DATA['plan-dark-mode'];
  const stepsHtml = data.steps.map(stepHtml).join('');
  const doneCount = data.steps.filter(s => s.status === 'done').length;

  return renderIcons(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<title>${esc(data.title)}</title>
${codiconLink(codiconUri)}
<style>
${baseStyles()}
body { overflow: auto; }
.page { max-width: 760px; margin: 0 auto; padding: 28px 32px 60px; }
.crumb { font-size: 11px; color: var(--ag-blue); text-transform: uppercase; letter-spacing: .6px; display: flex; align-items: center; gap: 6px; }
h1 { font-size: 22px; margin: 10px 0 4px; font-weight: 650; }
.subtitle { color: var(--ag-fg-muted); margin-bottom: 22px; }
.progress {
  display: flex; align-items: center; gap: 10px;
  background: var(--ag-input-bg); border: 1px solid var(--ag-border);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 20px;
}
.bar { flex: 1; height: 6px; background: rgba(128,128,128,0.25); border-radius: 3px; overflow: hidden; }
.bar > span { display: block; height: 100%; background: var(--ag-blue); border-radius: 3px; }
.progress-label { font-size: 11px; color: var(--ag-fg-muted); }
.steps { display: flex; flex-direction: column; gap: 2px; }
.step {
  display: flex; gap: 12px; padding: 11px 12px; border-radius: 8px;
  border: 1px solid transparent;
}
.step:hover { background: var(--ag-list-hover); }
.step.active { border-color: var(--ag-blue); background: rgba(138,180,248,0.07); }
.step-icon { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; }
.step.done .step-icon { color: var(--ag-green); }
.step.active .step-icon { color: var(--ag-blue); }
.step.todo .step-icon { color: var(--ag-fg-muted); }
.step-body { flex: 1; }
.step-title { font-weight: 600; }
.step.todo .step-title { color: var(--ag-fg-muted); }
.step-detail { font-size: 12px; margin-top: 2px; }
.file { display: inline-block; margin-top: 6px; font-family: var(--ag-code-font); font-size: 11px; color: var(--ag-purple); background: rgba(197,138,249,0.1); padding: 1px 6px; border-radius: 4px; }
.actions { display: flex; gap: 8px; margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--ag-border); }
.btn { background: var(--ag-btn-bg); color: var(--ag-btn-fg); border: none; border-radius: 6px; padding: 7px 14px; }
.btn:hover { background: var(--ag-btn-hover); }
.btn.secondary { background: transparent; color: var(--ag-fg); border: 1px solid var(--ag-border); }
.note { margin-top: 18px; font-size: 11px; color: var(--ag-fg-muted); display: flex; gap: 6px; align-items: center; }
</style>
</head>
<body>
<div class="page">
  <div class="crumb">$(symbol-file) Artifact · ${esc(data.kind)}</div>
  <h1>${esc(data.title)}</h1>
  <div class="subtitle">${esc(data.subtitle)}</div>
  <div class="progress">
    <span class="muted">Progress</span>
    <div class="bar"><span style="width:${Math.round(doneCount / data.steps.length * 100)}%"></span></div>
    <span class="progress-label">${doneCount}/${data.steps.length}</span>
  </div>
  <div class="steps">${stepsHtml}</div>
  <div class="actions">
    <button class="btn" id="accept">$(check) Accept changes</button>
    <button class="btn secondary" id="reject">$(close) Reject</button>
  </div>
  <div class="note">$(info) This is a UI-only mock. Buttons are visual placeholders and are not wired to any action.</div>
</div>
<script nonce="${nonce}">
${themeScript()}
const vscode = acquireVsCodeApi();
document.getElementById('accept').addEventListener('click', () => vscode.postMessage({ type: 'artifactAction', action: 'accept' }));
document.getElementById('reject').addEventListener('click', () => vscode.postMessage({ type: 'artifactAction', action: 'reject' }));
</script>
</body>
</html>`);
}

module.exports = { getHtml };
