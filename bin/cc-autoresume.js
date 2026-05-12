#!/usr/bin/env node

import { Command } from "commander";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseResetFromText, looksLikeUsageLimit } from "../src/parser.js";

const DEFAULT_SESSION = "claude-auto";
const DEFAULT_CLAUDE_WINDOW = "claude";
const WATCHER_WINDOW = "watcher";
const DEFAULT_MESSAGE = "continue";
const CONFIG_DIR = join(homedir(), ".config", "claude-code-autoresume");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(SCRIPT_PATH));

function exec(command, args = [], options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options
  }).trim();
}

function hasCommand(command) {
  try {
    exec("sh", ["-lc", `command -v ${shell(command)}`]);
    return true;
  } catch {
    return false;
  }
}

function shell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function requireTmux() {
  if (!hasCommand("tmux")) {
    console.error("tmux is required.");
    console.error("Install on macOS with: brew install tmux");
    console.error("If brew is missing, install Homebrew first: https://brew.sh");
    process.exit(1);
  }
}

function requireMacOs(commandName) {
  if (process.platform !== "darwin") {
    console.error(`${commandName} only supports macOS GUI automation right now.`);
    process.exit(1);
  }
}

function sessionExists(session) {
  try {
    exec("tmux", ["has-session", "-t", session]);
    return true;
  } catch {
    return false;
  }
}

function targetExists(target) {
  try {
    exec("tmux", ["display-message", "-p", "-t", target, "#{pane_id}"]);
    return true;
  } catch {
    return false;
  }
}

function resolveClaudeTarget(session) {
  if (!sessionExists(session)) return null;

  try {
    return exec("tmux", ["display-message", "-p", "-t", `${session}:${DEFAULT_CLAUDE_WINDOW}.0`, "#{pane_id}"]);
  } catch {}

  try {
    const panes = exec("tmux", [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{window_name}\t#{pane_id}"
    ]);

    for (const line of panes.split("\n")) {
      const [paneSession, windowName, paneId] = line.split("\t");
      if (paneSession === session && windowName !== WATCHER_WINDOW && paneId) {
        return paneId;
      }
    }
  } catch {}

  return null;
}

function capturePane(target, lines = 300) {
  try {
    return exec("tmux", ["capture-pane", "-t", target, "-p", "-S", `-${lines}`]);
  } catch {
    return "";
  }
}

function sendKeys(target, message) {
  exec("tmux", ["send-keys", "-t", target, message, "Enter"]);
}

function selectTarget(target) {
  try {
    exec("tmux", ["select-pane", "-t", target]);
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadConfig() {
  const defaults = {
    session: DEFAULT_SESSION,
    command: "claude",
    resumeMessage: DEFAULT_MESSAGE,
    pollIntervalSeconds: 30,
    captureLines: 300,
    notify: true
  };

  if (!existsSync(CONFIG_PATH)) return defaults;

  try {
    const userConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { ...defaults, ...userConfig };
  } catch {
    return defaults;
  }
}

function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function notify(title, message) {
  if (process.platform === "darwin") {
    try {
      exec("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
    } catch {}
  }
}

function sendGuiMessage(app, message, { pressEscape = false } = {}) {
  const script = [
    `tell application ${JSON.stringify(app)} to activate`,
    "delay 0.5",
    "tell application \"System Events\"",
    pressEscape ? "  key code 53" : null,
    pressEscape ? "  delay 0.2" : null,
    `  keystroke ${JSON.stringify(message)}`,
    "  key code 36",
    "end tell"
  ].filter(Boolean);

  exec("osascript", script.flatMap((line) => ["-e", line]));
}

function readClipboard() {
  return exec("pbpaste");
}

async function scheduleGuiResume({ resetText, app, message, pressEscape, dryRun, notificationsEnabled }) {
  const parsed = parseResetFromText(resetText);

  if (!parsed) {
    console.error(`Could not parse reset time from: ${resetText}`);
    console.error("Try: cc-autoresume gui --at 12:30am");
    process.exit(1);
  }

  const waitMs = Math.max(parsed.reset.getTime() - Date.now(), 0);

  console.log(`Detected: ${parsed.raw}`);
  console.log(`Will focus ${app} and send "${message}" at ${parsed.reset.toLocaleString()}`);
  console.log("Leave the Claude input box focused, or pass --press-escape if Escape focuses Claude in your VS Code view.");

  if (dryRun) return;

  if (notificationsEnabled) {
    notify("Claude Code Auto Resume", `Waiting until ${parsed.reset.toLocaleTimeString()} to resume VS Code Claude.`);
  }

  await sleep(waitMs);
  sendGuiMessage(app, message, { pressEscape });
  console.log(`Sent "${message}" to ${app}`);

  if (notificationsEnabled) {
    notify("Claude Code Auto Resume", `Sent ${message} to ${app}.`);
  }
}

function watchCommand(session, target) {
  return [
    shell(process.execPath),
    shell(SCRIPT_PATH),
    "watch",
    "-s",
    shell(session),
    "--target",
    shell(target)
  ].join(" ");
}

function startSession(session, command) {
  if (sessionExists(session)) {
    console.log(`Session already exists: ${session}`);
    return resolveClaudeTarget(session);
  }
  const paneId = exec("tmux", [
    "new-session",
    "-d",
    "-s",
    session,
    "-n",
    DEFAULT_CLAUDE_WINDOW,
    "-P",
    "-F",
    "#{pane_id}",
    command
  ]);
  console.log(`Started Claude Code session: ${session}`);
  return paneId;
}

function startWatcherWindow(session, target) {
  const windows = exec("tmux", ["list-windows", "-t", session, "-F", "#{window_name}"]);
  if (windows.split("\n").includes(WATCHER_WINDOW)) {
    exec("tmux", ["kill-window", "-t", `${session}:${WATCHER_WINDOW}`]);
    console.log(`Restarted watcher window in tmux session: ${session}`);
  }

  exec("tmux", ["new-window", "-t", session, "-n", WATCHER_WINDOW, "sh", "-lc", watchCommand(session, target)]);
  console.log(`Started watcher window in tmux session: ${session}`);
  console.log(`Watching Claude pane: ${target}`);
}

function attachSession(session) {
  spawn("tmux", ["attach", "-t", session], { stdio: "inherit" });
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

const program = new Command();

program
  .name("cc-autoresume")
  .description("Auto-resume Claude Code after the official usage-limit reset time.")
  .version("0.2.0");

program
  .command("init")
  .description("Create a default config file")
  .action(() => {
    const config = loadConfig();
    saveConfig(config);
    console.log(`Config written to ${CONFIG_PATH}`);
  });

program
  .command("doctor")
  .description("Check local requirements")
  .action(() => {
    const checks = [
      ["Node.js", true, process.version],
      ["tmux", hasCommand("tmux"), hasCommand("tmux") ? exec("tmux", ["-V"]) : "missing"],
      ["Claude Code CLI", hasCommand("claude"), hasCommand("claude") ? exec("sh", ["-lc", "command -v claude"]) : "missing"]
    ];

    for (const [name, ok, details] of checks) {
      console.log(`${ok ? "✓" : "✗"} ${name}: ${details}`);
    }

    if (!hasCommand("tmux")) {
      console.log("\nInstall tmux on macOS: brew install tmux");
    }
  });

program
  .command("start")
  .option("-s, --session <name>", "tmux session name")
  .option("-c, --command <command>", "command to run inside tmux")
  .description("Start Claude Code inside a managed tmux session")
  .action((opts) => {
    requireTmux();
    const config = loadConfig();
    const session = opts.session || config.session;
    const command = opts.command || config.command;

    const target = startSession(session, command);

    console.log(`Attach: cc-autoresume attach -s ${session}`);
    console.log(`Watch:  cc-autoresume watch -s ${session}${target ? ` --target ${target}` : ""}`);
  });

program
  .command("attach")
  .option("-s, --session <name>", "tmux session name")
  .description("Attach to the managed tmux session")
  .action((opts) => {
    requireTmux();
    const config = loadConfig();
    const session = opts.session || config.session;

    if (!sessionExists(session)) {
      console.error(`No tmux session found: ${session}`);
      process.exit(1);
    }

    attachSession(session);
  });

program
  .command("dev")
  .alias("vscode")
  .option("-s, --session <name>", "tmux session name")
  .option("-c, --command <command>", "command to run inside tmux")
  .description("Start Claude Code + watcher in tmux, then attach. Good for VS Code terminals.")
  .action((opts) => {
    requireTmux();
    const config = loadConfig();
    const session = opts.session || config.session;
    const command = opts.command || config.command;

    const target = startSession(session, command);

    if (!target) {
      console.error(`Could not resolve Claude pane for session: ${session}`);
      process.exit(1);
    }

    startWatcherWindow(session, target);
    selectTarget(target);

    console.log("\nVS Code workflow:");
    console.log("1. Use this attached tmux session as your Claude Code terminal.");
    console.log("2. Detach without stopping Claude: Ctrl+B, then D.");
    console.log("3. Reattach anytime: cc-autoresume attach");
    console.log("\nAttaching now...\n");

    attachSession(session);
  });

program
  .command("watch")
  .option("-s, --session <name>", "tmux session name")
  .option("-t, --target <target>", "tmux pane/window target to watch and resume")
  .option("-m, --message <message>", "message to send after reset")
  .option("-i, --interval <seconds>", "poll interval in seconds")
  .option("--no-notify", "disable desktop notification")
  .description("Watch a tmux session and auto-send continue after the reset time")
  .action(async (opts) => {
    requireTmux();
    const config = loadConfig();
    const session = opts.session || config.session;
    const target = opts.target || config.target || resolveClaudeTarget(session);
    const message = opts.message || config.resumeMessage;
    const intervalMs = Number(opts.interval || config.pollIntervalSeconds) * 1000;
    const captureLines = Number(config.captureLines || 300);
    const notificationsEnabled = opts.notify && config.notify;

    if (!sessionExists(session)) {
      console.error(`No tmux session found: ${session}`);
      process.exit(1);
    }

    if (!target || !targetExists(target)) {
      console.error(`No Claude pane found for session: ${session}`);
      console.error("Start one with: cc-autoresume dev");
      process.exit(1);
    }

    let scheduledRaw = null;
    console.log(`Watching session: ${session}`);
    console.log(`Watching target: ${target}`);

    while (true) {
      const pane = capturePane(target, captureLines);

      if (looksLikeUsageLimit(pane)) {
        const parsed = parseResetFromText(pane);

        if (parsed && parsed.raw !== scheduledRaw) {
          scheduledRaw = parsed.raw;
          const waitMs = Math.max(parsed.reset.getTime() - Date.now(), 0);

          console.log(`Detected: ${parsed.raw}`);
          console.log(`Will send "${message}" at ${parsed.reset.toLocaleString()}`);

          if (notificationsEnabled) {
            notify("Claude Code Auto Resume", `Waiting until ${parsed.reset.toLocaleTimeString()} to resume.`);
          }

          await sleep(waitMs);
          sendKeys(target, message);
          console.log(`Sent "${message}" to ${target}`);

          if (notificationsEnabled) {
            notify("Claude Code Auto Resume", `Sent ${message} to ${target}.`);
          }

          await sleep(60_000);
        }
      }

      await sleep(intervalMs);
    }
  });

program
  .command("gui")
  .alias("vscode-gui")
  .argument("[resetText...]", "reset text, for example: \"resets 12:30am\" or \"resets in 1h\"")
  .option("-r, --reset <text>", "reset text to parse")
  .option("--at <time>", "reset clock time, for example 12:30am")
  .option("--in <duration>", "relative wait, for example 1h, 90m, or \"1h 15m\"")
  .option("--clipboard", "read reset text from the macOS clipboard")
  .option("--watch-clipboard", "wait until the clipboard contains a Claude limit message")
  .option("-a, --app <name>", "macOS app name to focus", "Visual Studio Code")
  .option("-m, --message <message>", "message to type after reset")
  .option("-i, --interval <seconds>", "clipboard polling interval in seconds", "2")
  .option("--press-escape", "press Escape before typing, useful if Claude is not focused")
  .option("--dry-run", "show the parsed schedule without typing anything")
  .option("--no-notify", "disable desktop notification")
  .description("Resume a non-terminal VS Code Claude session with macOS GUI automation")
  .action(async (resetTextParts, opts) => {
    requireMacOs("gui");
    const config = loadConfig();
    const message = opts.message || config.resumeMessage;
    const notificationsEnabled = opts.notify && config.notify;
    const intervalMs = Math.max(Number(opts.interval || 2), 1) * 1000;

    if (opts.watchClipboard) {
      console.log("Watching clipboard for a Claude usage-limit reset message...");
      console.log("Copy the reset banner from VS Code, then leave the Claude input focused.");

      let lastClipboard = null;

      while (true) {
        const clipboard = readClipboard();

        if (clipboard && clipboard !== lastClipboard) {
          lastClipboard = clipboard;

          if (looksLikeUsageLimit(clipboard) && parseResetFromText(clipboard)) {
            await scheduleGuiResume({
              resetText: clipboard,
              app: opts.app,
              message,
              pressEscape: opts.pressEscape,
              dryRun: opts.dryRun,
              notificationsEnabled
            });
            return;
          }
        }

        await sleep(intervalMs);
      }
    }

    const resetText =
      opts.reset ||
      (opts.at ? `resets ${opts.at}` : null) ||
      (opts.in ? `resets in ${opts.in}` : null) ||
      (opts.clipboard ? readClipboard() : null) ||
      resetTextParts.join(" ");

    if (!resetText.trim()) {
      console.error("Provide reset text, for example:");
      console.error("  cc-autoresume gui \"resets in 1h\"");
      console.error("  cc-autoresume gui --at 12:30am");
      console.error("  cc-autoresume gui --clipboard");
      process.exit(1);
    }

    await scheduleGuiResume({
      resetText,
      app: opts.app,
      message,
      pressEscape: opts.pressEscape,
      dryRun: opts.dryRun,
      notificationsEnabled
    });
  });

program
  .command("status")
  .option("-s, --session <name>", "tmux session name")
  .option("-t, --target <target>", "tmux pane/window target to inspect")
  .description("Show recent terminal output from the session")
  .action((opts) => {
    requireTmux();
    const config = loadConfig();
    const session = opts.session || config.session;
    const target = opts.target || config.target || resolveClaudeTarget(session);

    if (!sessionExists(session)) {
      console.error(`No tmux session found: ${session}`);
      process.exit(1);
    }

    if (!target || !targetExists(target)) {
      console.error(`No Claude pane found for session: ${session}`);
      process.exit(1);
    }

    console.log(capturePane(target, config.captureLines));
  });

program
  .command("fake-test")
  .option("-s, --session <name>", "fake tmux session name", "fake-claude")
  .option("--minutes <number>", "reset time minutes from now", "2")
  .description("Create a fake Claude limit session for local testing")
  .action((opts) => {
    requireTmux();
    const session = opts.session;
    const minutes = Number(opts.minutes || 2);
    const reset = new Date(Date.now() + minutes * 60_000);
    const resetText = formatClock(reset);
    const message = `You're out of extra usage · resets ${resetText} (Asia/Jerusalem)`;

    if (sessionExists(session)) {
      exec("tmux", ["kill-session", "-t", session]);
    }

    exec("tmux", ["new-session", "-d", "-s", session, "sh", "-lc", `echo ${shell(message)}; sleep 9999`]);

    console.log(`Created fake session: ${session}`);
    console.log(`Fake message: ${message}`);
    console.log(`Now run: cc-autoresume watch -s ${session}`);
  });

program.parse();
