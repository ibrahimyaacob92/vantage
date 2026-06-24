import { test, expect } from "bun:test";
import { sweep } from "../src/watchdog";
import { SessionStore } from "../src/sessions";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Project } from "../src/types";

const tmp = () => join(mkdtempSync(join(tmpdir(), "projflow-")), "x.json");
const projects: Project[] = [{ id: "web", name: "web", path: "/dev/web", devCommand: "pnpm dev", port: null, url: null, enabled: true }];
const opts = (alive: boolean) => ({ pidAlive: () => alive, goneGraceMs: 10_000 });

test("working session with dead pid -> error", () => {
  const store = new SessionStore(tmp());
  store.upsertFromHook({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: "/dev/web", pid: 1 } as any, projects, 1);
  // ensure pid is set
  store.upsertFromHook({ hook_event_name: "SessionStart", session_id: "s1", cwd: "/dev/web", pid: 1234 } as any, projects, 2);
  store.upsertFromHook({ hook_event_name: "PreToolUse", session_id: "s1", cwd: "/dev/web", tool_name: "Bash" } as any, projects, 3);
  sweep(store, 4, opts(false));
  expect(store.get("s1")?.status).toBe("error");
});

test("idle session with dead pid -> gone", () => {
  const store = new SessionStore(tmp());
  store.upsertFromHook({ hook_event_name: "SessionStart", session_id: "s2", cwd: "/dev/web", pid: 1234 } as any, projects, 1);
  sweep(store, 2, opts(false));
  expect(store.get("s2")?.status).toBe("gone");
});

test("working session with live pid but stale heartbeat stays working", () => {
  const store = new SessionStore(tmp());
  store.upsertFromHook({ hook_event_name: "SessionStart", session_id: "s3", cwd: "/dev/web", pid: 1234 } as any, projects, 1);
  store.upsertFromHook({ hook_event_name: "PreToolUse", session_id: "s3", cwd: "/dev/web", tool_name: "Bash" } as any, projects, 2);
  sweep(store, 2 + 200_000, opts(true)); // very stale but alive
  expect(store.get("s3")?.status).toBe("working");
});

test("error session with still-dead pid -> gone on second sweep, then reaped after grace window", () => {
  const store = new SessionStore(tmp());
  // Set up a working session with a dead pid
  store.upsertFromHook({ hook_event_name: "SessionStart", session_id: "s4", cwd: "/dev/web", pid: 9999 } as any, projects, 1);
  store.upsertFromHook({ hook_event_name: "PreToolUse", session_id: "s4", cwd: "/dev/web", tool_name: "Bash" } as any, projects, 2);

  // First sweep: working + dead pid -> error
  sweep(store, 3, opts(false));
  expect(store.get("s4")?.status).toBe("error");

  // Second sweep: error + still-dead pid -> gone
  sweep(store, 4, opts(false));
  expect(store.get("s4")?.status).toBe("gone");

  // Within grace window: session is still present
  store.removeGone(4 + 5_000, 10_000);
  expect(store.get("s4")).toBeDefined();

  // After grace window: session is removed
  store.removeGone(4 + 11_000, 10_000);
  expect(store.get("s4")).toBeUndefined();
});
