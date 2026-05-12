import test from "node:test";
import assert from "node:assert/strict";
import { parseResetFromText, looksLikeUsageLimit } from "../src/parser.js";

test("detects Claude usage-limit reset message", () => {
  const text = "You're out of extra usage · resets 12:30am (Asia/Jerusalem)";
  assert.equal(looksLikeUsageLimit(text), true);
});

test("parses 12:30am reset", () => {
  const now = new Date("2026-05-12T20:00:00");
  const parsed = parseResetFromText("resets 12:30am (Asia/Jerusalem)", now);
  assert.ok(parsed);
  assert.equal(parsed.reset.getHours(), 0);
  assert.equal(parsed.reset.getMinutes(), 30);
  assert.equal(parsed.timezone, "Asia/Jerusalem");
});

test("moves passed reset time to tomorrow", () => {
  const now = new Date("2026-05-12T01:00:00");
  const parsed = parseResetFromText("resets 12:30am", now);
  assert.ok(parsed.reset.getDate() > now.getDate());
});

test("parses relative reset durations", () => {
  const now = new Date("2026-05-12T20:00:00");
  const parsed = parseResetFromText("You've hit your session limit · resets in 1h 15m ·", now);
  assert.ok(parsed);
  assert.equal(parsed.reset.getTime(), new Date("2026-05-12T21:15:00").getTime());
  assert.equal(parsed.raw, "resets in 1h 15m");
});

test("detects session-limit reset duration", () => {
  const text = "You've hit your session limit · resets in 1h ·";
  assert.equal(looksLikeUsageLimit(text), true);
});
