import { test, expect } from "bun:test";
import { parseLsofListen, parsePidCwd, PortDetector } from "../src/detect-ports";
import { DetectionStore } from "../src/detection";
import type { Project } from "../src/types";

// `lsof -nP -iTCP -sTCP:LISTEN -F pn` emits records: p<pid> then n<host:port> lines.
const LSOF = ["p510", "nlocalhost:3000", "p511", "n127.0.0.1:8787", "p512", "n*:22"].join("\n");

test("parseLsofListen extracts pid + port pairs", () => {
  expect(parseLsofListen(LSOF)).toEqual([
    { pid: 510, port: 3000 },
    { pid: 511, port: 8787 },
    { pid: 512, port: 22 },
  ]);
});

test("parsePidCwd reads the n-line from `lsof -a -d cwd -p <pid> -F n`", () => {
  const out = ["p510", "fcwd", "n/Users/me/dev/iris-web"].join("\n");
  expect(parsePidCwd(out)).toBe("/Users/me/dev/iris-web");
});

test("sweep maps a listening pid's cwd to a project and records the port", async () => {
  const projects: Project[] = [
    { id: "iris", name: "iris", path: "/Users/me/dev/iris-web", devCommand: "pnpm dev", port: 3000, url: null, enabled: true },
  ];
  const store = new DetectionStore();
  const detector = new PortDetector(store, {
    listSockets: async () => ["p510", "nlocalhost:3000"].join("\n"),
    pidCwd: async () => ["p510", "fcwd", "n/Users/me/dev/iris-web/sub"].join("\n"),
  });
  await detector.sweep(projects);
  expect(store.getDev("iris")).toEqual({ running: true, port: 3000, pid: 510, managed: false });
});

test("sweep clears projects whose servers disappeared", async () => {
  const projects: Project[] = [
    { id: "iris", name: "iris", path: "/Users/me/dev/iris-web", devCommand: "pnpm dev", port: null, url: null, enabled: true },
  ];
  const store = new DetectionStore();
  store.setDev("iris", { running: true, port: 3000, pid: 999, managed: false });
  const detector = new PortDetector(store, { listSockets: async () => "", pidCwd: async () => "" });
  await detector.sweep(projects);
  expect(store.getDev("iris").running).toBe(false);
});
