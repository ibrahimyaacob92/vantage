import { test, expect } from "bun:test";
import { formatBarTitle, buildTrayMenu, sortViews } from "../src/bun/format";

const v = (id: string, headline: string, opts: any = {}) => ({
  project: { id, name: id, port: opts.port ?? null, url: null },
  claude: { count: opts.count ?? 1, headline, needsAttention: ["blocked_permission","error","blocked_input"].includes(headline), sessions: [] },
  dev: { running: !!opts.port, port: opts.port ?? null, pid: null, managed: false },
  browser: { tabOpen: !!opts.tab, ref: null },
});

test("sortViews puts needs-attention first, idle last", () => {
  const sorted = sortViews([v("a","idle"), v("b","blocked_permission"), v("c","working")]);
  expect(sorted.map((x) => x.project.id)).toEqual(["b","c","a"]);
});

test("formatBarTitle renders B summary + A per-project row", () => {
  const t = formatBarTitle([v("iris","blocked_permission",{port:3000}), v("pay","working"), v("mktg","idle")]);
  expect(t).toBe("🔴1 🟡1 🔵1 ┃ 🔴iris 🟡pay 🔵mktg");
});

test("formatBarTitle with no projects shows the app name", () => {
  expect(formatBarTitle([])).toBe("Vantage");
});

test("buildTrayMenu has a disabled header per project, a divider, Settings and Quit", () => {
  const menu = buildTrayMenu([v("iris","blocked_permission",{port:3000,tab:true})]);
  expect(menu[0]).toMatchObject({ enabled: false });
  expect(menu[0].label).toContain("iris");
  expect(menu[0].label).toContain("3000");
  expect(menu.some((m) => m.action === "settings")).toBe(true);
  expect(menu.some((m) => m.action === "quit")).toBe(true);
});
