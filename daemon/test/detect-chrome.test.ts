import { test, expect } from "bun:test";
import { parseChromeTabs, matchTab, ChromeDetector } from "../src/detect-chrome";
import { DetectionStore } from "../src/detection";
import type { Project } from "../src/types";

const TABS = ["1|1|https://news.example.com", "1|2|http://localhost:3000/app", "2|1|http://localhost:8787/"].join("\n");
const proj = (id: string, port: number | null, url: string | null): Project =>
  ({ id, name: id, path: `/dev/${id}`, devCommand: "pnpm dev", port, url, enabled: true });

test("parseChromeTabs parses wi|ti|url rows", () => {
  expect(parseChromeTabs(TABS)).toEqual([
    { windowIndex: 1, tabIndex: 1, url: "https://news.example.com" },
    { windowIndex: 1, tabIndex: 2, url: "http://localhost:3000/app" },
    { windowIndex: 2, tabIndex: 1, url: "http://localhost:8787/" },
  ]);
});

test("matchTab matches by explicit url first", () => {
  const t = matchTab(proj("iris", 3000, "http://localhost:3000"), parseChromeTabs(TABS));
  expect(t).toEqual({ windowIndex: 1, tabIndex: 2, url: "http://localhost:3000/app" });
});

test("matchTab falls back to :port", () => {
  const t = matchTab(proj("pay", 8787, null), parseChromeTabs(TABS));
  expect(t?.tabIndex).toBe(1);
  expect(t?.windowIndex).toBe(2);
});

test("matchTab returns null when no tab matches", () => {
  expect(matchTab(proj("none", 9999, null), parseChromeTabs(TABS))).toBeNull();
});

test("refresh records ref for matched projects and clears others", async () => {
  const store = new DetectionStore();
  store.setBrowser("stale", { tabOpen: true, ref: { windowIndex: 9, tabIndex: 9 } });
  const detector = new ChromeDetector(store, { enumerate: async () => TABS });
  await detector.refresh([proj("pay", 8787, null)]);
  expect(store.getBrowser("pay")).toEqual({ tabOpen: true, ref: { windowIndex: 2, tabIndex: 1 } });
  expect(store.getBrowser("stale").tabOpen).toBe(false);
});
