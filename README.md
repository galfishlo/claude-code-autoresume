# Claude Code Auto Resume

Automatically resumes Claude Code after the official usage-limit reset time.

This does **not** bypass, avoid, or manipulate Claude usage limits. It watches your local terminal session, or waits for a reset time you provide for a GUI session, and sends `continue` after that time arrives.

## What it solves

When Claude Code prints something like:

```text
You're out of extra usage · resets 12:30am (Asia/Jerusalem)
```

this tool can keep your Claude Code session alive, wait until 12:30am, and then automatically send:

```text
continue
```

It also understands relative reset messages like:

```text
You've hit your session limit · resets in 1h ·
```

## Requirements

- macOS or Linux
- Node.js 18+
- tmux
- Claude Code CLI installed and authenticated

Check your setup:

```bash
cc-autoresume doctor
```

On macOS, install tmux:

```bash
brew install tmux
```

If `brew` is missing, install Homebrew first from https://brew.sh.

## Install

```bash
npm install -g claude-code-autoresume
```

For local development:

```bash
git clone https://github.com/YOUR_USERNAME/claude-code-autoresume.git
cd claude-code-autoresume
npm install
npm test
```

You can run it locally without linking:

```bash
npx . --help
```

If `npm link` fails with an `EACCES` permission error, use `npx .` for local testing or fix your npm global directory. Avoid `sudo npm link` unless you understand the tradeoff.

## Quick start

Start Claude Code inside a managed tmux session:

```bash
cc-autoresume start
```

Attach to the session:

```bash
cc-autoresume attach
```

In another terminal, start the watcher:

```bash
cc-autoresume watch
```

Detach from tmux without killing Claude Code:

```text
Ctrl+B, then D
```

Reattach anytime:

```bash
cc-autoresume attach
```

## VS Code usage

This works in VS Code when Claude Code is launched inside `tmux` from the VS Code integrated terminal.

Open a VS Code terminal and run:

```bash
cc-autoresume dev
```

or, when developing locally from this repo:

```bash
cd ~/Downloads/claude-code-autoresume
npx . dev
```

The `dev` command:

1. Starts Claude Code in a tmux session.
2. Pins the watcher to Claude Code's exact tmux pane.
3. Starts a watcher in a second tmux window.
4. Attaches you to the Claude Code window.

Important: this tool cannot reliably control an already-running normal VS Code terminal or Claude sidebar/extension session. Claude Code must be running inside the tmux session.

If you already have a managed tmux session, `start` prints the pane target:

```text
Watch:  cc-autoresume watch -s claude-auto --target %3
```

Use that exact `--target` when you want to run the watcher yourself from another VS Code terminal.

## VS Code GUI usage

If you use Claude in the VS Code side panel or chat UI instead of a terminal, tmux cannot see or control that session. On macOS, use GUI mode:

```bash
cc-autoresume gui "resets in 1h"
```

or:

```bash
cc-autoresume gui --at 12:30am
```

Then leave the Claude input box focused in VS Code. At the reset time, the tool activates VS Code, types `continue`, and presses Enter through macOS Accessibility automation.

If Escape focuses Claude in your VS Code view, you can ask the tool to press it first:

```bash
cc-autoresume gui "resets in 1h" --press-escape
```

The first run may require granting Accessibility permission to your terminal app, Codex, or Node.js in macOS System Settings.

To avoid retyping the reset message, copy the Claude banner text and read it from the clipboard:

```bash
cc-autoresume gui --clipboard
```

For the closest thing to automatic detection in the VS Code GUI flow, start clipboard watch before or after you hit the limit:

```bash
cc-autoresume gui --watch-clipboard
```

Then copy the Claude limit message, for example:

```text
You're out of extra usage · resets 12:30am (Asia/Jerusalem)
```

or:

```text
You've hit your session limit · resets in 1h ·
```

Once the clipboard contains a recognizable reset message, the tool schedules the resume. Leave the Claude input focused before the reset time.

This GUI mode does not directly read the Claude side panel yet. It uses the clipboard because VS Code webview contents are not reliably exposed to a normal CLI process.

## Real-world test

If you are currently rate-limited, run:

```bash
cc-autoresume start
cc-autoresume status
```

You should see the Claude Code reset message in the captured output.

Then run:

```bash
cc-autoresume watch
```

Expected output:

```text
Watching session: claude-auto
Detected: resets 12:30am (Asia/Jerusalem)
Will send "continue" at ...
```

Leave the watcher running.

## Fake local test

Create a fake Claude Code limit session with a reset time 2 minutes from now:

```bash
cc-autoresume fake-test
```

Then run:

```bash
cc-autoresume watch -s fake-claude
```

After the fake reset time passes, verify the message was sent:

```bash
tmux capture-pane -t fake-claude -p -S -50
```

Clean up:

```bash
tmux kill-session -t fake-claude
```

## Commands

```bash
cc-autoresume init       # create config file
cc-autoresume doctor     # check Node, tmux, and Claude Code
cc-autoresume start      # start Claude Code in tmux
cc-autoresume attach     # attach to the tmux session
cc-autoresume watch      # watch for reset messages and auto-continue
cc-autoresume status     # show recent Claude pane output
cc-autoresume dev        # start Claude + watcher in tmux, then attach
cc-autoresume vscode     # alias for dev
cc-autoresume gui        # resume a VS Code GUI session on macOS
cc-autoresume fake-test  # create a fake limit session for testing
```

## Config

Create a config file:

```bash
cc-autoresume init
```

Default location:

```text
~/.config/claude-code-autoresume/config.json
```

Example:

```json
{
  "session": "claude-auto",
  "command": "claude",
  "resumeMessage": "continue",
  "pollIntervalSeconds": 30,
  "captureLines": 300,
  "notify": true
}
```

Optional advanced setting:

```json
{
  "target": "%3"
}
```

Normally you do not need `target`; `cc-autoresume dev` resolves it automatically. Set it only when you want to pin the watcher to a specific tmux pane.

## Custom session

```bash
cc-autoresume start --session my-claude
cc-autoresume watch --session my-claude
cc-autoresume attach --session my-claude
```

## Troubleshooting

### `tmux is required`

Install tmux:

```bash
brew install tmux
```

### `npx .` fails outside the repo

`npx .` means “run the package in the current folder.” Use it only from inside the project folder:

```bash
cd ~/Downloads/claude-code-autoresume
npx . watch
```

After publishing/installing globally, use:

```bash
cc-autoresume watch
```

### Existing VS Code Claude session is not detected

That session was probably not started inside tmux. Start Claude through:

```bash
cc-autoresume dev
```

or:

```bash
cc-autoresume start
cc-autoresume attach
```

If you start with `cc-autoresume start` and run the watcher separately, copy the full command it prints, including `--target %...`. Watching only the session name can point at the wrong tmux window after a watcher window is created.

For the VS Code side panel or chat UI, use:

```bash
cc-autoresume gui "resets in 1h"
```

Leave the Claude input focused before you walk away.

If you want it to recognize the copied message automatically:

```bash
cc-autoresume gui --watch-clipboard
```

### `/rate-limit-options` menu is open

Close the menu before watching. Attach to the session and press `Esc`, then detach with `Ctrl+B`, then `D`.

## Safety note

This project is a productivity helper. It respects the official reset time shown by Claude Code. Do not use it to spam requests, bypass limits, or violate Anthropic's terms.

## License

MIT
