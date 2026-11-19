// Shared styling and helpers for all PerchAI UI webviews.
// Theme variables map VS Code's CSS custom properties so the clone follows
// the active color theme, just like the real extension.

function baseStyles() {
  return `
  :root {
    --ag-bg: var(--vscode-sideBar-background, #1f1f1f);
    --ag-fg: var(--vscode-sideBar-foreground, #cccccc);
    --ag-fg-muted: var(--vscode-descriptionForeground, #9d9d9d);
    --ag-border: var(--vscode-panel-border, rgba(128,128,128,0.25));
    --ag-input-bg: var(--vscode-input-background, #313131);
    --ag-input-fg: var(--vscode-input-foreground, #cccccc);
    --ag-input-border: var(--vscode-input-border, transparent);
    --ag-btn-bg: var(--vscode-button-background, #0e639c);
    --ag-btn-fg: var(--vscode-button-foreground, #ffffff);
    --ag-btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --ag-list-hover: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06));
    --ag-list-active: var(--vscode-list-activeSelectionBackground, #094771);
    --ag-accent: var(--vscode-focusBorder, #007fd4);
    --ag-blue: #8ab4f8;
    --ag-green: #81c995;
    --ag-yellow: #fdd663;
    --ag-red: #f28b82;
    --ag-purple: #c58af9;
    --ag-font: var(--vscode-font-family, system-ui, sans-serif);
    --ag-font-size: var(--vscode-font-size, 13px);
    --ag-code-font: var(--vscode-editor-font-family, monospace);

    /* Perch Terminal palette (sampled from the app UI). */
    --p-bg: #1a1613;
    --p-bg-raised: #1d1916;
    --p-bg-input: #1e1a17;
    --p-border: #302a24;
    --p-border-strong: #3d342b;
    --p-text: #e8e2da;
    --p-text-dim: #a89e92;
    --p-text-faint: #7a7067;
    --p-gold: #c19f6a;
    --p-green: #81c995;
    --p-orange: #d99a5b;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: var(--ag-font);
    font-size: var(--ag-font-size);
    color: var(--ag-fg);
    background: var(--ag-bg);
    line-height: 1.5;
    overflow: hidden;
  }
  button { font-family: inherit; font-size: inherit; cursor: pointer; }
  .icon { width: 15px; height: 15px; flex: 0 0 auto; opacity: 0.9; }
  .muted { color: var(--ag-fg-muted); }
  .row { display: flex; align-items: center; }
  .gap { gap: 8px; }
  .spacer { flex: 1; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.4)); }
  ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100,100,100,0.7)); }
  `;
}

// Script injected into every webview to listen for theme changes sent from extension host.
function themeScript() {
  return `
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'theme') {
      document.body.dataset.theme = msg.theme;
    }
  });
  `;
}

// Returns a <link> tag that loads VS Code's codicon stylesheet inside a webview.
// The stylesheet embeds its font as a data URI, so no separate font file is needed.
function codiconLink(codiconUri) {
  return codiconUri ? `<link rel="stylesheet" href="${codiconUri}">` : '';
}

// Convert VS Code-style `$(icon)` tokens in an HTML string into real codicon
// spans. The codicon CSS only styles elements that carry the `codicon` class
// plus a `codicon-<name>` class; the `$(...)` syntax is native-UI shorthand
// that a plain webview does not understand on its own.
//   $(book)       -> <span class="codicon codicon-book"></span>
//   $(sync~spin)  -> <span class="codicon codicon-sync codicon-modifier-spin"></span>
// This runs as the final step on a fully assembled HTML string, so it also
// catches icons inside interpolated fragments (badges, artifact cards, etc.).
function renderIcons(html) {
  return String(html).replace(/\$\(([a-z0-9-]+)(~[a-z]+)?\)/g, (_full, name, modifier) => {
    const mod = modifier ? ` codicon-modifier-${modifier.slice(1)}` : '';
    return `<span class="codicon codicon-${name}${mod}"></span>`;
  });
}

// Escape helper for any dynamic text injected into HTML.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { baseStyles, themeScript, codiconLink, renderIcons, esc };
