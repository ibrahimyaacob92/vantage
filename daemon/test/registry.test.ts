import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Registry } from "../src/registry";
import type { Project } from "../src/types";

const mk = (id: string): Project => ({
  id, name: id, path: `/dev/${id}`, devCommand: "pnpm dev", port: null, url: null, enabled: true,
});

let file: string;
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), "projflow-")), "projects.json"); });

test("add + list + get round-trip, persists to disk", async () => {
  const r = new Registry(file);
  await r.load();
  await r.add(mk("web"));
  expect(r.list().map((p) => p.id)).toEqual(["web"]);

  const r2 = new Registry(file);
  await r2.load();
  expect(r2.get("web")?.name).toBe("web");
});

test("update patches fields", async () => {
  const r = new Registry(file);
  await r.load();
  await r.add(mk("web"));
  const updated = await r.update("web", { port: 3000 });
  expect(updated.port).toBe(3000);
  expect(r.get("web")?.port).toBe(3000);
});

test("remove deletes", async () => {
  const r = new Registry(file);
  await r.load();
  await r.add(mk("web"));
  await r.remove("web");
  expect(r.list()).toEqual([]);
});

test("load on missing file starts empty", async () => {
  const r = new Registry(file);
  await r.load();
  expect(r.list()).toEqual([]);
});

test("corrupt projects.json degrades to empty registry, no throw", async () => {
  await Bun.write(file, "{ not json");
  const r = new Registry(file);
  await r.load(); // must not throw
  expect(r.list()).toEqual([]);
});
