import { test, expect } from "bun:test";
import { app, __setStores } from "../src/index";
import { Registry } from "../src/registry";
import { SessionStore } from "../src/sessions";
import { DetectionStore } from "../src/detection";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmp = () => join(mkdtempSync(join(tmpdir(), "projflow-")), "x.json");
const seed = async () => {
  const registry = new Registry(tmp()); await registry.load();
  __setStores(registry, new SessionStore(tmp()), new DetectionStore());
  return registry;
};
const body = (o: any) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

test("POST then GET /projects round-trips", async () => {
  await seed();
  const p = { id: "web", name: "web", path: "/dev/web", devCommand: "pnpm dev", port: 3000, url: null, enabled: true };
  const post = await app.request("/projects", body(p));
  expect(post.status).toBe(201);
  const list = await (await app.request("/projects")).json();
  expect(list.map((x: any) => x.id)).toEqual(["web"]);
});

test("PUT patches and DELETE removes", async () => {
  await seed();
  const p = { id: "web", name: "web", path: "/dev/web", devCommand: "pnpm dev", port: 3000, url: null, enabled: true };
  await app.request("/projects", body(p));
  const put = await app.request("/projects/web", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ port: 4000 }) });
  expect((await put.json()).port).toBe(4000);
  const del = await app.request("/projects/web", { method: "DELETE" });
  expect((await del.json())).toEqual({ ok: true });
  expect(await (await app.request("/projects")).json()).toEqual([]);
});

test("PUT on a missing project returns 404", async () => {
  await seed();
  const res = await app.request("/projects/nope", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ port: 1 }) });
  expect(res.status).toBe(404);
});

test("POST with invalid JSON body returns 400", async () => {
  await seed();
  const res = await app.request("/projects", { method: "POST", headers: { "content-type": "application/json" }, body: "{ not json" });
  expect(res.status).toBe(400);
});

test("DELETE on a missing project returns 404", async () => {
  await seed();
  const res = await app.request("/projects/nope", { method: "DELETE" });
  expect(res.status).toBe(404);
});
