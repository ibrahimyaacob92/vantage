import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionStore } from "../src/sessions";
import type { Project, HookPayload } from "../src/types";

const projects: Project[] = [
  { id: "web", name: "web", path: "/dev/web", devCommand: "pnpm dev", port: null, url: null, enabled: true },
];
const ev = (name: string, extra: Partial<HookPayload> = {}): HookPayload =>
  ({ hook_event_name: name, session_id: "s1", cwd: "/dev/web/sub", ...extra });

let file: string;
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), "projflow-")), "sessions.json"); });

test("first hook creates session and resolves project by longest prefix", () => {
  const store = new SessionStore(file);
  const s = store.upsertFromHook(ev("SessionStart", { pid: 7 }), projects, 100);
  expect(s.projectId).toBe("web");
  expect(s.status).toBe("idle");
  expect(store.all().length).toBe(1);
});

test("subsequent hooks update the same session", () => {
  const store = new SessionStore(file);
  store.upsertFromHook(ev("SessionStart"), projects, 1);
  const s = store.upsertFromHook(ev("PreToolUse", { tool_name: "Edit" }), projects, 2);
  expect(s.status).toBe("working");
  expect(s.detail).toBe("Edit");
  expect(store.all().length).toBe(1);
});

test("removeGone drops sessions ended past the grace window", () => {
  const store = new SessionStore(file);
  store.upsertFromHook(ev("SessionEnd"), projects, 1000);
  store.removeGone(1000 + 5000, 10000);   // within grace -> kept
  expect(store.all().length).toBe(1);
  store.removeGone(1000 + 11000, 10000);  // past grace -> removed
  expect(store.all().length).toBe(0);
});

test("state survives reload from disk", async () => {
  const store = new SessionStore(file);
  store.upsertFromHook(ev("SessionStart", { pid: 9 }), projects, 1);
  const store2 = new SessionStore(file);
  await store2.load();
  expect(store2.get("s1")?.pid).toBe(9);
});
