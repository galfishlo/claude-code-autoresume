#!/usr/bin/env node

import { Command } from "commander";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseResetFromText, looksLikeUsageLimit } from "../src/parser.js";

const DEFAULT_SESSION = "claude-auto";
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

function sessionExists(session) {
  try {
    exec("tmux", ["has-session", "-t", session]);
    return true;
  } catch {
    return false;
  }
}

function capturePane(session, lines = 300) {
  try {
    return exec("tmux", ["capture-pane", "-t", session, "-p", "-S", `-${lines}`]);
  } catch {
    return "";
  }
}

function sendKeys(session, message) {
  exec("tmux", ["send-keys", "-t", session, message, "Enter"]);
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

function watchCommand(session) {
  return `${shell(process.execPath)} ${shell(SCRIPT_PATH)} watch -s ${shell(session)}`;
}

function startSession(session, command) {
  if (sessionExists(session)) {
    console.log(`Session already exists: ${session}`);
    return;
  }
  exec("tmux", ["new-session", "-d", "-s", session, command]);
  console.log(`Started Claude Code session: ${session}`);
}

function startWatcherWindow(session) {
  const windows = exec("tmux", ["list-windows", "-t", session, "-F", "#{window_name}"]);
  if (windows.split("\n").includes("watcher")) {
    console.log(`Watcher window already exists in session: ${session}`);
    return;
  }

  exec("tmux", ["new-window", "-t", session, "-n", "watcher", "sh", "-lc", watchCommand(session)]);
  console.log(`Started watcher window in tmux session: ${session}`);
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

    startSession(session, command);

    console.log(`Attach: cc-autoresume attach -s ${session}`);
    console.log(`Watch:  cc-autoresume watch -s ${session}`);
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

    startSession(session, command);
    startWatcherWindow(session);

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
  .option("-m, --message <message>", "message to send after reset")
  .option("-i, --interval <seconds>", "poll interval in seconds")
  .option("--no-notify", "disable desktop notification")
  .description("Watch a tmux session and auto-send continue after the reset time")
  .action(async (opts) => {
    requireTmux();
    const config = loadConfig();
    const session = opts.session || config.session;
    const message = opts.message || config.resumeMessage;
    const intervalMs = Number(opts.interval || config.pollIntervalSeconds) * 1000;
    const captureLines = Number(config.captureLines || 300);
    const notificationsEnabled = opts.notify && config.notify;

    if (!sessionExists(session)) {
      console.error(`No tmux session found: ${session}`);
      process.exit(1);
    }

    let scheduledRaw = null;
    console.log(`Watching session: ${session}`);

    while (true) {
      const pane = capturePane(session, captureLines);

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
          sendKeys(session, message);
          console.log(`Sent "${message}" to ${session}`);

          if (notificationsEnabled) {
            notify("Claude Code Auto Resume", `Sent ${message} to ${session}.`);
          }

          await sleep(60_000);
        }
      }

      await sleep(intervalMs);
    }
  });

program
  .command("status")
  .option("-s, --session <name>", "tmux session name")
  .description("Show recent terminal output from the session")
  .action((opts) => {
    requireTmux();
    const config = loadConfig();
    const session = opts.session || config.session;

    if (!sessionExists(session)) {
      console.error(`No tmux session found: ${session}`);
      process.exit(1);
    }

    console.log(capturePane(session, config.captureLines));
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
