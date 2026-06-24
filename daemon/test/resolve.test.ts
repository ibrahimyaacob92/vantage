import { test, expect } from "bun:test";
import { resolveProjectId } from "../src/resolve";
import type { Project } from "../src/types";

const mk = (id: string, path: string): Project => ({
  id, name: id, path, devCommand: "pnpm dev", port: null, url: null, enabled: true,
});

const projects = [mk("web", "/Users/x/dev/web"), mk("web-api", "/Users/x/dev/web/api")];

test("matches the longest prefix (monorepo subdir)", () => {
  expect(resolveProjectId("/Users/x/dev/web/api/src", projects)).toBe("web-api");
});

test("matches parent when not under a deeper project", () => {
  expect(resolveProjectId("/Users/x/dev/web/ui", projects)).toBe("web");
});

test("returns null when nothing matches", () => {
  expect(resolveProjectId("/tmp/other", projects)).toBeNull();
});

test("does not match a partial path segment", () => {
  expect(resolveProjectId("/Users/x/dev/website", projects)).toBeNull();
});
