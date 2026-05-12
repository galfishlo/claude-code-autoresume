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
