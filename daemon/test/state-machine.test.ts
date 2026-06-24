import { test, expect } from "bun:test";
import { newSession, transition } from "../src/state-machine";
import type { HookPayload } from "../src/types";

const ev = (name: string, extra: Partial<HookPayload> = {}): HookPayload =>
  ({ hook_event_name: name, session_id: "s1", cwd: "/dev/web", ...extra });

const base = () => newSession("s1", "/dev/web", 1000);

test("SessionStart captures pid + transcript and is idle", () => {
  const s = transition(base(), ev("SessionStart", { pid: 42, transcript_path: "/t.jsonl" }), 1001);
  expect(s.status).toBe("idle");
  expect(s.pid).toBe(42);
  expect(s.transcriptPath).toBe("/t.jsonl");
});

test("UserPromptSubmit -> working and clears detail", () => {
  const s = transition({ ...base(), detail: "old" }, ev("UserPromptSubmit"), 1002);
  expect(s.status).toBe("working");
  expect(s.detail).toBeNull();
});

test("PreToolUse -> working with tool name in detail", () => {
  const s = transition(base(), ev("PreToolUse", { tool_name: "Bash" }), 1003);
  expect(s.status).toBe("working");
  expect(s.detail).toBe("Bash");
});

test("PermissionRequest -> blocked_permission", () => {
  expect(transition(base(), ev("PermissionRequest"), 1).status).toBe("blocked_permission");
});

test("Notification permission_prompt -> blocked_permission", () => {
  const s = transition(base(), ev("Notification", { notification: { type: "permission_prompt" } }), 1);
  expect(s.status).toBe("blocked_permission");
});

test("Notification idle_prompt -> blocked_input", () => {
  const s = transition(base(), ev("Notification", { notification: { type: "idle_prompt" } }), 1);
  expect(s.status).toBe("blocked_input");
});

test("Notification elicitation_dialog -> blocked_input with MCP detail", () => {
  const s = transition(base(), ev("Notification", { notification: { type: "elicitation_dialog" } }), 1);
  expect(s.status).toBe("blocked_input");
  expect(s.detail).toBe("MCP input");
});

test("Notification auth_success is ignored (status unchanged)", () => {
  const start = transition(base(), ev("UserPromptSubmit"), 1);
  const s = transition(start, ev("Notification", { notification: { type: "auth_success" } }), 2);
  expect(s.status).toBe("working");
});

test("Stop -> idle", () => {
  const w = transition(base(), ev("UserPromptSubmit"), 1);
  expect(transition(w, ev("Stop"), 2).status).toBe("idle");
});

test("StopFailure -> error with subtype detail", () => {
  const s = transition(base(), ev("StopFailure", { error: { subtype: "rate_limit" } }), 1);
  expect(s.status).toBe("error");
  expect(s.detail).toBe("rate_limit");
});

test("Subagent start/stop adjusts count and detail", () => {
  let s = transition(base(), ev("UserPromptSubmit"), 1);
  s = transition(s, ev("SubagentStart"), 2);
  expect(s.subagents).toBe(1);
  expect(s.detail).toBe("working, 1 agents");
  s = transition(s, ev("SubagentStop"), 3);
  expect(s.subagents).toBe(0);
});

test("PreCompact -> compacting, PostCompact -> working", () => {
  const c = transition(base(), ev("PreCompact"), 1);
  expect(c.status).toBe("compacting");
  expect(transition(c, ev("PostCompact"), 2).status).toBe("working");
});

test("SessionEnd -> gone", () => {
  expect(transition(base(), ev("SessionEnd"), 1).status).toBe("gone");
});

test("every event bumps lastEventAt and records lastEvent, without mutating input", () => {
  const s0 = base();
  const s1 = transition(s0, ev("PreToolUse", { tool_name: "Read" }), 9999);
  expect(s1.lastEventAt).toBe(9999);
  expect(s1.lastEvent).toBe("PreToolUse");
  expect(s0.lastEventAt).toBe(1000); // input untouched
});
