# PerchAI VS Code Extension

A VS Code sidebar chat that runs **real Perch turns** through the installed `perch` CLI. It looks like Perch Terminal's chat UI and is backed by the same operator engine.

## How it works

The composer calls the documented one-shot CLI form:

```
perch run "<task>" --json --cwd <dir> --mode <mode> --permission <mode> [--model <tier>] [--thread <id>]
```

`backend.js` spawns that command, resolves the `perch` binary from nvm/npm-global even when VS Code was launched from the GUI, and parses the result. Each run's `threadId` is saved to workspace settings so the next message continues the same conversation.

**No mock replies.** Every assistant message comes from a real Perch run.

**On streaming:** `perch run --json` buffers its output and emits the whole JSON document when the run finishes — there is no live token stream to display. So the UI shows an honest working state with a spinner and elapsed timer, then renders the answer (with markdown formatting), a collapsible step list, and a copy button.

## Prerequisites

1. Install the CLI: `npm install -g perchai-cli` (Node 22+)
2. Sign in: `perch login`
3. Check: `perch status` should show you're signed in.

## Run it

1. Open this folder in VS Code: `code /path/to/perchai`
2. Press `F5` to launch the Extension Development Host.
3. The **chat** appears directly in the Secondary Side Bar (right side), shown by default. Everything happens here unless you explicitly ask for a window.
4. Type a task and press Enter (or click an example prompt). While a run is active you get a working spinner with elapsed time; the answer then renders with formatting, collapsible steps, and a Copy button.
5. Only if you want a bigger view, click the **Open conversation in a window** icon in the header (or run `PerchAI: Open Conversation in Window`). That opens the same conversation in an editor tab, which you can drag into a separate window. Both views stay in sync.

The composer has a full set of CLI-backed controls:
- **Paperclip** (`file-add`) attaches files via a VS Code picker; they appear as removable chips and are passed as repeatable `--attach <path>` flags.
- **Drag & drop** files or images anywhere in the chat: a themed overlay appears while dragging, and dropped files become the same removable attachment chips. Because a webview can't see real filesystem paths, the extension host writes dropped files to a temp folder, attaches them via `--attach`, and cleans the folder up after the run (or on reset/deactivate).
- **Skill** (`symbol-method`) opens a native Quick Pick of all skills from `perch skills` (built-in + user); selected skills are passed as `--skill <id>`.
- **Gear** opens per-run options: model, mode, permission, **effort** (`--effort`), and **persona** (`--persona`).
- **Undo** in the header runs `/undo` in the current thread after confirmation (CLI-verified; it restores the last file changes Perch made).

## Reviewing workspace changes (optional)

After each run, the extension snapshots the working folder before the run and compares it afterward. If files changed, an inline panel lists them with their status (`modified`, `added`, `deleted`) and the source (`git status` in a git repo, otherwise a workspace hash snapshot). It's informational — you can ignore it entirely.

Click any file in the panel to **expand its diff** before deciding: additions are green, deletions red, context grey, with a gold hunk header. In a git repo the diff comes from `git diff`; otherwise it's computed from the pre-run snapshot with a line diff. The diff loads on first click.

- **Accept** keeps the changes and just discards the backup.
- **Reject** restores files to their pre-run state and removes files created during the run (after a confirmation). Backups live in a temp folder outside the workspace, so they never show up as changes themselves.

Pending backups are cleared on a new conversation, on deactivate, or when you resolve the panel. Note: Reject restores file *contents* from the snapshot; it is not a git checkout and does not undo changes made outside the workspace.

The send button turns into Stop while a run is active. **Up/Down** in the composer recalls your previous prompts (terminal-style, newest first); a draft you were typing is preserved when you navigate back down, and the history persists across reloads and is shared with the optional window. When you open a saved conversation from history, Up/Down walks that conversation's own prompts (merged with your global history), so it works in historical conversations too. Use `Cmd/Ctrl+Alt+B` to toggle the Secondary Side Bar.

## Settings

All under `perchai.*` in VS Code Settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `perchai.cliPath` | auto | Path to `perch`; blank auto-detects nvm/npm-global |
| `perchai.cwd` | workspace folder | Folder the operator works in |
| `perchai.mode` | `agents` | `ask`, `agents`, or `plan` |
| `perchai.permission` | `auto_review` | `auto_review`, `take_the_wheel`, `default`, `plan` |
| `perchai.persona` | (none) | `saffron` or `quill` |
| `perchai.model` | (Roost auto) | Roost tier or model name |
| `perchai.effort` | (auto) | Thinking effort: off/low/medium/high/xhigh/max/ultra |
| `perchai.threadId` | (folder default) | Continue a specific thread |

The composer's model/mode/permission selects override the settings per run. Each conversation tab owns its own thread id, so sessions stay independent.

**Permission modes in one-shot runs:** the extension uses `perch run`, which has no interactive approval prompt. `default` and `plan` therefore stop with `approval_required` for any write/command. The default is **Auto Review** (reversible work runs, consequential actions are reviewed) — verified to create files. **Take the Wheel** also works. If you pick Default or Plan and hit an approval stop, the error message tells you to switch to Auto Review or Take the Wheel.

## Account management

Click the account button in a chat header, or **Manage account** in the launcher, or run `PerchAI: Manage Account`. A native VS Code Quick Pick shows the current state and the options:

- **Usage** shows your Perch Token allowance (from `/usage`, since `perch usage` is not a shell command in v2.4.140) in an output channel.
- **Model routing** shows read-only `perch byok status` and `perch byolm status`, so you can see whether turns run on Roost, a cloud key, or a local model.
- **Sign in with Google / GitHub** runs `perch login google|github` (opens a browser tab).
- **Sign out** runs `perch logout` after confirmation. Per the CLI docs, this clears only the CLI session; your browser sign-in is left alone.

## Conversation history

- **History** uses the native VS Code Quick Pick (like the Command Palette): click the clock icon in the chat header, or run `PerchAI: Conversations` (`Cmd/Ctrl+L`). Type to filter saved threads (from `~/.perch/threads`); picking one loads it into the sidebar chat with its full message history. There's also a **New conversation** entry.
- **New conversation** (`Cmd/Ctrl+Shift+L`) clears the sidebar chat and starts a fresh thread.
- The active conversation is always shown in the sidebar. It only appears in an editor tab if you explicitly choose **Open Conversation in Window**.

Verified against the CLI: `perch run --thread <id>` resumes a saved thread, and a fresh id creates a new one.

## Commands

- `PerchAI: New Conversation` (`Cmd/Ctrl+Shift+L`) — fresh conversation in the sidebar
- `PerchAI: Conversations` (`Cmd/Ctrl+L`) — native Quick Pick history
- `PerchAI: Open Conversation in Window` — show the current chat in an editor tab/window
- `PerchAI: Attach files to next message`
- `PerchAI: Choose skill`
- `PerchAI: Undo last file changes`
- `PerchAI: Manage Account` (usage, routing, sign in/out)
- `PerchAI: Choose working folder`
- `PerchAI: Open Artifact`
- `PerchAI: Toggle Secondary Side Bar` (`Cmd/Ctrl+Alt+B`)

## Files

- `package.json` — manifest, views, commands, settings
- `extension.js` — activation, view provider, run orchestration, cancellation
- `backend.js` — CLI bridge: spawn, PATH resolution, JSON parsing, event streaming
- `webviews/chat.js` — chat UI and message handling (sidebar + optional window)
- `webviews/artifact.js` — artifact viewer
- `webviews/shared.js` — shared theme CSS and helpers
- `media/icon.svg`, `media/codicon/` — icons

## Notes

- Permission `default` asks before consequential actions; the CLI enforces this, not the webview.
- Tool calls that need approval happen in the CLI's own flow; this sidebar shows the run's progress and final answer.
- Artifact viewer buttons remain visual placeholders.
- No build step or dependencies required. Edit any `webviews/*.js` or `backend.js` and reload the dev host (`Cmd/Ctrl+R`).
