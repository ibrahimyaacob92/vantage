import { test, expect } from "bun:test";
import { app, __setStores } from "../src/index";
import { Registry } from "../src/registry";
import { SessionStore } from "../src/sessions";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmp = () => join(mkdtempSync(join(tmpdir(), "projflow-")), "x.json");

test("GET /health returns ok", async () => {
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("POST /hook then GET /state reflects the session", async () => {
  const registry = new Registry(tmp()); await registry.load();
  await registry.add({ id: "web", name: "web", path: "/dev/web", devCommand: "pnpm dev", port: null, url: null, enabled: true });
  __setStores(registry, new SessionStore(tmp()));

  const post = await app.request("/hook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hook_event_name: "PermissionRequest", session_id: "s1", cwd: "/dev/web" }),
  });
  expect(post.status).toBe(200);
  expect(await post.json()).toEqual({ ok: true });

  const state = (await (await app.request("/state")).json()) as any[];
  const web = state.find((v) => v.project.id === "web");
  expect(web.claude.headline).toBe("blocked_permission");
  expect(web.claude.needsAttention).toBe(true);
});
