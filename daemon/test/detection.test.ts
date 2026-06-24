import { test, expect } from "bun:test";
import { DetectionStore } from "../src/detection";

test("unknown project returns safe defaults", () => {
  const d = new DetectionStore();
  expect(d.getDev("x")).toEqual({ running: false, port: null, pid: null, managed: false });
  expect(d.getBrowser("x")).toEqual({ tabOpen: false, ref: null });
});

test("set/get dev and browser round-trip", () => {
  const d = new DetectionStore();
  d.setDev("web", { running: true, port: 3000, pid: 111, managed: false });
  d.setBrowser("web", { tabOpen: true, ref: { windowIndex: 1, tabIndex: 2 } });
  expect(d.getDev("web").port).toBe(3000);
  expect(d.getBrowser("web").ref).toEqual({ windowIndex: 1, tabIndex: 2 });
});

test("clearDevExcept wipes projects not in the keep-list", () => {
  const d = new DetectionStore();
  d.setDev("a", { running: true, port: 1, pid: 1, managed: false });
  d.setDev("b", { running: true, port: 2, pid: 2, managed: false });
  d.clearDevExcept(["a"]);
  expect(d.getDev("a").running).toBe(true);
  expect(d.getDev("b").running).toBe(false);
});
