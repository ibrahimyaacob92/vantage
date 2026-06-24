import { test, expect } from "bun:test";
import { handleHook } from "../src/hooks";
import { Registry } from "../src/registry";
import { SessionStore } from "../src/sessions";
import { buildProjectViews } from "../src/derive";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Project } from "../src/types";

const tmp = () => join(mkdtempSync(join(tmpdir(), "projflow-")), "x.json");
const web: Project = { id: "web", name: "web", path: "/dev/web", devCommand: "pnpm dev", port: null, url: null, enabled: true };

test("permission request makes the project needsAttention", async () => {
  const registry = new Registry(tmp()); await registry.load(); await registry.add(web);
  const store = new SessionStore(tmp());
  handleHook({ hook_event_name: "SessionStart", session_id: "s1", cwd: "/dev/web", pid: 5 }, registry, store, 1);
  handleHook({ hook_event_name: "PermissionRequest", session_id: "s1", cwd: "/dev/web" }, registry, store, 2);
  const view = buildProjectViews(registry.list(), store.all()).find((v) => v.project.id === "web")!;
  expect(view.claude.headline).toBe("blocked_permission");
  expect(view.claude.needsAttention).toBe(true);
});
