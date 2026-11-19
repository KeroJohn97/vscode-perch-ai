// Optional change tracking for Perch runs.
// Before a run we snapshot the workspace. After the run we report which files
// changed. Accept is a no-op (changes stay); Reject restores the snapshot.
// In a git repo we use `git status --porcelain` for the file list; otherwise we
// compare file hashes. Backups are written outside the workspace so they don't
// show up as changes themselves.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.perch', 'codicon', 'dist', 'build',
  'Library', 'Cache', 'Caches', '.vscode'
]);

function isGitRepo(root) {
  try {
    return cp.execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  } catch (_) { return false; }
}

function walk(root, dir, out, depth) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full);
    if (e.isDirectory()) walk(root, full, out, depth + 1);
    else if (e.isFile()) out.push(rel);
  }
}

function hashFile(p) {
  try {
    const buf = fs.readFileSync(p);
    if (buf.length > 5 * 1024 * 1024) return 'big:' + buf.length; // skip hashing huge files
    return crypto.createHash('sha1').update(buf).digest('hex');
  } catch (_) { return 'missing'; }
}

// Snapshot the workspace. Returns a token used later to detect changes.
function snapshot(root) {
  const files = [];
  walk(root, root, files, 0);
  const hashes = {};
  for (const rel of files) hashes[rel] = hashFile(path.join(root, rel));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perchai-changes-'));
  // Back up only small text-ish files that we can restore safely.
  const backed = {};
  for (const rel of files) {
    const full = path.join(root, rel);
    try {
      const st = fs.statSync(full);
      if (st.size > 2 * 1024 * 1024) continue;
      const dest = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(full, dest);
      backed[rel] = true;
    } catch (_) {}
  }
  return {
    root,
    hashes,
    backupDir,
    backed,
    git: isGitRepo(root),
    at: Date.now()
  };
}

// Compare current workspace to a snapshot. Returns a change report.
function detect(snap) {
  if (!snap) return { files: [], git: false };
  const root = snap.root;
  const current = [];
  walk(root, root, current, 0);
  const changed = [];

  if (snap.git) {
    // Git knows about tracked/untracked changes precisely.
    let out = '';
    try {
      out = cp.execFileSync('git', ['-C', root, 'status', '--porcelain'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {}
    const gitFiles = new Set();
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const p = line.slice(3).trim().split(' -> ').pop();
      gitFiles.add(p);
    }
    for (const rel of gitFiles) {
      changed.push({ path: rel, status: statusLabel(rel, snap, root) });
    }
  }

  // Always also diff hashes so untracked edits in non-git folders are caught.
  const seen = new Set(changed.map(c => c.path));
  const currentSet = new Set(current);
  for (const rel of current) {
    if (seen.has(rel)) continue;
    const oldHash = snap.hashes[rel];
    const newHash = hashFile(path.join(root, rel));
    if (oldHash === undefined) changed.push({ path: rel, status: 'added' });
    else if (oldHash !== newHash) changed.push({ path: rel, status: 'modified' });
  }
  for (const rel of Object.keys(snap.hashes)) {
    if (!currentSet.has(rel) && !seen.has(rel)) changed.push({ path: rel, status: 'deleted' });
  }
  return { files: changed, git: snap.git };
}

function statusLabel(rel, snap, root) {
  if (!Object.prototype.hasOwnProperty.call(snap.hashes, rel)) return 'added';
  if (!fs.existsSync(path.join(root, rel))) return 'deleted';
  return 'modified';
}

// Accept: keep changes, just drop the backup.
function accept(snap) {
  if (!snap) return;
  cleanup(snap);
}

// Reject: restore every backed-up file to its pre-run state, and remove files
// that were newly added during the run.
function reject(snap) {
  if (!snap) return { restored: [], removed: [] };
  const restored = [], removed = [];
  // Remove files that did not exist before the run.
  const current = [];
  walk(snap.root, snap.root, current, 0);
  for (const rel of current) {
    if (!Object.prototype.hasOwnProperty.call(snap.hashes, rel)) {
      try { fs.rmSync(path.join(snap.root, rel), { force: true }); removed.push(rel); } catch (_) {}
    }
  }
  // Restore files from backup.
  for (const rel of Object.keys(snap.backed)) {
    const src = path.join(snap.backupDir, rel);
    const dest = path.join(snap.root, rel);
    try {
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        restored.push(rel);
      }
    } catch (_) {}
  }
  cleanup(snap);
  return { restored, removed };
}

function cleanup(snap) {
  if (snap && snap.backupDir) {
    try { fs.rmSync(snap.backupDir, { recursive: true, force: true }); } catch (_) {}
  }
}

// Produce a unified-ish line diff for one changed file, comparing the pre-run
// backup (or empty for a new file) with the current content. Returns an array
// of { type: 'add'|'del'|'ctx'|'hunk', text } rows for the UI to color.
function getDiff(snap, rel) {
  if (!snap) return null;
  const root = snap.root;
  const currentPath = path.join(root, rel);
  const backupPath = path.join(snap.backupDir, rel);

  // In a git repo, prefer `git diff` for tracked files (accurate, handles renames).
  if (snap.git) {
    try {
      const out = cp.execFileSync('git', ['-C', root, 'diff', '--no-color', '--', rel],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4 * 1024 * 1024 });
      const untracked = !Object.prototype.hasOwnProperty.call(snap.hashes, rel);
      const raw = untracked
        ? (safeRead(currentPath) || '').split('\n').map(l => '+' + l).join('\n')
        : out;
      if (raw && raw.trim()) return parseUnified(raw);
    } catch (_) {}
  }

  // Fallback: diff backup vs current using LCS.
  const before = safeRead(backupPath) || '';
  const after = safeRead(currentPath) || '';
  return lineDiff(before, after);
}

function safeRead(p) {
  try {
    const st = fs.statSync(p);
    if (st.size > 2 * 1024 * 1024) return null;
    return fs.readFileSync(p, 'utf8');
  } catch (_) { return null; }
}

function parseUnified(raw) {
  const rows = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) rows.push({ type: 'hunk', text: line });
    else if (line.startsWith('+') && !line.startsWith('+++')) rows.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith('-') && !line.startsWith('---')) rows.push({ type: 'del', text: line.slice(1) });
    else if (line.startsWith(' ')) rows.push({ type: 'ctx', text: line.slice(1) });
  }
  return rows;
}

// Simple LCS line diff. Fine for the small text files this extension handles.
function lineDiff(before, after) {
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];
  const n = a.length, m = b.length;
  // Cap to avoid O(n*m) blowups on large files.
  if (n * m > 4000000) {
    return [{ type: 'hunk', text: 'Diff too large to display' }]
      .concat(b.slice(0, 200).map(l => ({ type: 'add', text: l })));
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'ctx', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', text: a[i] }); i++; }
    else { rows.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) { rows.push({ type: 'del', text: a[i++] }); }
  while (j < m) { rows.push({ type: 'add', text: b[j++] }); }
  return rows;
}

module.exports = { snapshot, detect, accept, reject, cleanup, isGitRepo, getDiff };
