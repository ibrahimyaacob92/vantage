# projflow Phase 2 — Detection + Menu-Bar UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make projflow visible and live: detect dev servers (`lsof`) and Chrome tabs (AppleScript) and fold them into `GET /state`, add project registry HTTP CRUD, and build the Electrobun menu-bar app that renders the inline A+B row + native dropdown from `/state` (no row actions yet — those are Phase 3).

**Architecture:** Two new daemon detector modules (pure parsers + injectable command runners) update an in-memory detection store that `buildProjectViews` reads to fill the previously-stubbed `dev` and `browser` fields. The Electrobun app (`ui/`) is a thin client: a Bun main process owns a `Tray`, polls `GET /state` every ~1s, renders the bar via `tray.setTitle()` (emoji-coded) and the dropdown via `tray.setMenu()`, and opens a Settings `BrowserWindow` that does registry CRUD over HTTP.

**Tech Stack:** Bun 1.3.10, Hono (daemon), **Electrobun 1.18.1** (`electrobun/bun` main, `electrobun/view` webview), `bun:test`. macOS `lsof` + `osascript` (AppleScript).

## Global Constraints

- **Builds on Phase 1 (merged to main).** Daemon at `127.0.0.1:7777`. `ProjectView` already has `dev: { running, port, pid, managed }` and `browser: { tabOpen, ref }` fields, currently hard-stubbed in `daemon/src/derive.ts` (`buildProjectViews`). Phase 2 fills them; do not change the `ProjectView` shape.
- **Join key stays the absolute project path; longest-prefix match** (reuse `resolveProjectId` from `daemon/src/resolve.ts`).
- **Tray API (verified, Electrobun 1.18.1):** `new Tray({ title?, image?, template? })`; `tray.setTitle(string)`; `tray.setMenu(MenuItemConfig[])`; `tray.on("tray-clicked", handler)` where the event's `action` is `""` for a bar click or the menu item's `action` string. `MenuItemConfig = { label?, action?, type?: "normal"|"divider", submenu?, enabled?, checked?, hidden?, tooltip? }`.
- **Bar title is a plain string** — color comes from emoji dots only: `🔴` blocked/error/blocked_input (needsAttention), `🟣` compacting, `🟡` working, `🔵` idle, `⚪` gone. No per-character styling.
- **`BrowserWindow`** options: `{ title, url, frame: { width, height, x, y }, styleMask }`; webview loads `views://<name>/index.html`.
- **Detectors must never block `/state` or `/hook`.** They run on timers and write to an in-memory store; `/state` reads the latest snapshot. `lsof`/`osascript` failures degrade to "nothing detected", never throw upstream.
- **Polling intervals:** ports ~4s; Chrome tabs ~ on demand (when the tray menu opens) to keep idle cost low; UI polls `/state` ~1s.
- **No row actions in Phase 2.** Dropdown shows per-project status + opens Settings + Quit. Start-dev/Open-browser/Focus-editor are Phase 3.

---

## File Structure (Phase 2)

```
daemon/src/
  detect-ports.ts      # parseLsofListen(), runner, PortDetector (timer) -> DetectionStore
  detect-chrome.ts     # parseChromeTabs(), matchTab(), ChromeDetector (on-demand)
  detection.ts         # DetectionStore: in-memory dev/browser per projectId
  derive.ts            # MODIFY buildProjectViews(projects, sessions, detection)
  index.ts             # MODIFY: registry CRUD routes; start PortDetector; /actions/chrome/refresh
daemon/test/
  detect-ports.test.ts
  detect-chrome.test.ts
  detection.test.ts
  derive.test.ts       # MODIFY: dev/browser now populated
  projects-api.test.ts # registry CRUD over HTTP

ui/
  package.json         # electrobun dep + scripts (already scaffolded)
  electrobun.config.ts # app + build config
  src/
    bun/
      main.ts          # Tray + poll /state + setTitle/setMenu + open settings window
      format.ts        # formatBarTitle(views), buildTrayMenu(views)  (PURE, tested)
      api.ts           # fetchState(), project CRUD helpers (HTTP to daemon)
    views/
      settings/
        index.html
        index.ts       # registry CRUD UI (fetch to daemon)
  test/
    format.test.ts     # PURE formatter tests (runnable via `bun test`)
```

---

## Task 1: DetectionStore (in-memory dev/browser per project)

**Files:**
- Create: `daemon/src/detection.ts`
- Test: `daemon/test/detection.test.ts`

**Interfaces:**
- Produces: `interface DevInfo { running: boolean; port: number|null; pid: number|null; managed: boolean }`; `interface BrowserInfo { tabOpen: boolean; ref: { windowIndex: number; tabIndex: number }|null }`; `class DetectionStore` with `setDev(projectId, DevInfo)`, `getDev(projectId): DevInfo`, `setBrowser(projectId, BrowserInfo)`, `getBrowser(projectId): BrowserInfo`, `clearDevExcept(projectIds: string[])`, `clearBrowserExcept(projectIds: string[])`. Getters return a safe default (`{running:false,port:null,pid:null,managed:false}` / `{tabOpen:false,ref:null}`) for unknown ids.

- [ ] **Step 1: Write the failing test `daemon/test/detection.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails** — `cd daemon && bun test test/detection.test.ts` → FAIL (no `DetectionStore`).

- [ ] **Step 3: Create `daemon/src/detection.ts`**

```ts
export interface DevInfo { running: boolean; port: number | null; pid: number | null; managed: boolean; }
export interface BrowserInfo { tabOpen: boolean; ref: { windowIndex: number; tabIndex: number } | null; }

const NO_DEV: DevInfo = { running: false, port: null, pid: null, managed: false };
const NO_BROWSER: BrowserInfo = { tabOpen: false, ref: null };

export class DetectionStore {
  private dev = new Map<string, DevInfo>();
  private browser = new Map<string, BrowserInfo>();

  setDev(id: string, info: DevInfo) { this.dev.set(id, info); }
  getDev(id: string): DevInfo { return this.dev.get(id) ?? { ...NO_DEV }; }
  setBrowser(id: string, info: BrowserInfo) { this.browser.set(id, info); }
  getBrowser(id: string): BrowserInfo { return this.browser.get(id) ?? { ...NO_BROWSER }; }

  clearDevExcept(ids: string[]) {
    const keep = new Set(ids);
    for (const id of [...this.dev.keys()]) if (!keep.has(id)) this.dev.delete(id);
  }
  clearBrowserExcept(ids: string[]) {
    const keep = new Set(ids);
    for (const id of [...this.browser.keys()]) if (!keep.has(id)) this.browser.delete(id);
  }
}
```

- [ ] **Step 4: Run the test, verify it passes** — `cd daemon && bun test test/detection.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/detection.ts daemon/test/detection.test.ts
git commit -m "feat(daemon): in-memory detection store for dev/browser state"
```

---

## Task 2: Port detector (`lsof` parser + poller)

**Files:**
- Create: `daemon/src/detect-ports.ts`
- Test: `daemon/test/detect-ports.test.ts`

**Interfaces:**
- Consumes: `Project` (types), `resolveProjectId` (resolve.ts), `DetectionStore` + `DevInfo` (detection.ts).
- Produces: `interface ListenSocket { pid: number; port: number }`; `parseLsofListen(output: string): ListenSocket[]`; `parsePidCwd(output: string): string | null`; `class PortDetector` with `constructor(store, opts: { listSockets: () => Promise<string>; pidCwd: (pid: number) => Promise<string>; })`, `async sweep(projects: Project[]): Promise<void>`, `start(getProjects, intervalMs): Timer`. `sweep` resolves each listening pid's cwd → project (longest-prefix) and calls `store.setDev(projectId, {running:true,port,pid,managed:false})`, then `clearDevExcept` for projects no longer seen (preserving any `managed:true` entries — Phase 3 sets those; in Phase 2 none are managed).

- [ ] **Step 1: Write the failing test `daemon/test/detect-ports.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails** — `cd daemon && bun test test/detect-ports.test.ts` → FAIL.

- [ ] **Step 3: Create `daemon/src/detect-ports.ts`**

```ts
import type { Project } from "./types";
import { resolveProjectId } from "./resolve";
import type { DetectionStore } from "./detection";

export interface ListenSocket { pid: number; port: number; }

export function parseLsofListen(output: string): ListenSocket[] {
  const out: ListenSocket[] = [];
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1)) || null;
    else if (line.startsWith("n") && pid != null) {
      const m = line.match(/:(\d+)$/);
      if (m) out.push({ pid, port: Number(m[1]) });
    }
  }
  return out;
}

export function parsePidCwd(output: string): string | null {
  for (const line of output.split("\n")) if (line.startsWith("n")) return line.slice(1);
  return null;
}

export interface PortDetectorDeps {
  listSockets: () => Promise<string>;            // lsof -nP -iTCP -sTCP:LISTEN -F pn
  pidCwd: (pid: number) => Promise<string>;      // lsof -a -d cwd -p <pid> -F n
}

export class PortDetector {
  constructor(private store: DetectionStore, private deps: PortDetectorDeps) {}

  async sweep(projects: Project[]): Promise<void> {
    let seen: string[] = [];
    try {
      const sockets = parseLsofListen(await this.deps.listSockets());
      const cwdCache = new Map<number, string | null>();
      for (const { pid, port } of sockets) {
        if (!cwdCache.has(pid)) {
          try { cwdCache.set(pid, parsePidCwd(await this.deps.pidCwd(pid))); }
          catch { cwdCache.set(pid, null); }
        }
        const cwd = cwdCache.get(pid);
        if (!cwd) continue;
        const projectId = resolveProjectId(cwd, projects);
        if (!projectId) continue;
        // keep an already-managed entry's flag; otherwise mark detected
        const prev = this.store.getDev(projectId);
        this.store.setDev(projectId, { running: true, port, pid, managed: prev.managed });
        seen.push(projectId);
      }
    } catch { /* lsof failed — treat as nothing listening */ }
    this.store.clearDevExcept(seen);
  }

  start(getProjects: () => Project[], intervalMs = 4000) {
    return setInterval(() => { void this.sweep(getProjects()); }, intervalMs);
  }
}

// Real command runners (used in index.ts wiring).
export const realPortDeps: PortDetectorDeps = {
  listSockets: async () =>
    (await Bun.$`lsof -nP -iTCP -sTCP:LISTEN -F pn`.quiet().nothrow()).stdout.toString(),
  pidCwd: async (pid: number) =>
    (await Bun.$`lsof -a -d cwd -p ${pid} -F n`.quiet().nothrow()).stdout.toString(),
};
```

- [ ] **Step 4: Run the test, verify it passes** — `cd daemon && bun test test/detect-ports.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/detect-ports.ts daemon/test/detect-ports.test.ts
git commit -m "feat(daemon): lsof port detector with injectable runners"
```

---

## Task 3: Chrome detector (AppleScript parser + matcher)

**Files:**
- Create: `daemon/src/detect-chrome.ts`
- Test: `daemon/test/detect-chrome.test.ts`

**Interfaces:**
- Consumes: `Project`, `DetectionStore` + `BrowserInfo`.
- Produces: `interface ChromeTab { windowIndex: number; tabIndex: number; url: string }`; `parseChromeTabs(output: string): ChromeTab[]` (input lines `wi|ti|url`); `matchTab(project: Project, tabs: ChromeTab[]): ChromeTab | null` (match by `project.url` host:port, else by `:${project.port}`, else by project path basename heuristics — keep simple: url/port only); `class ChromeDetector` with `constructor(store, opts: { enumerate: () => Promise<string> })`, `async refresh(projects: Project[]): Promise<void>`. `refresh` sets `browser` per project and `clearBrowserExcept` for the rest.

- [ ] **Step 1: Write the failing test `daemon/test/detect-chrome.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails** — `cd daemon && bun test test/detect-chrome.test.ts` → FAIL.

- [ ] **Step 3: Create `daemon/src/detect-chrome.ts`**

```ts
import type { Project } from "./types";
import type { DetectionStore } from "./detection";

export interface ChromeTab { windowIndex: number; tabIndex: number; url: string; }

export function parseChromeTabs(output: string): ChromeTab[] {
  const out: ChromeTab[] = [];
  for (const line of output.split("\n")) {
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const wi = Number(parts[0]); const ti = Number(parts[1]);
    if (!wi || !ti) continue;
    out.push({ windowIndex: wi, tabIndex: ti, url: parts.slice(2).join("|") });
  }
  return out;
}

export function matchTab(project: Project, tabs: ChromeTab[]): ChromeTab | null {
  if (project.url) {
    const base = project.url.replace(/\/$/, "");
    const hit = tabs.find((t) => t.url.startsWith(base));
    if (hit) return hit;
  }
  if (project.port != null) {
    const needle = `:${project.port}`;
    const hit = tabs.find((t) => t.url.includes(needle));
    if (hit) return hit;
  }
  return null;
}

export interface ChromeDetectorDeps { enumerate: () => Promise<string>; }

export class ChromeDetector {
  constructor(private store: DetectionStore, private deps: ChromeDetectorDeps) {}

  async refresh(projects: Project[]): Promise<void> {
    let seen: string[] = [];
    try {
      const tabs = parseChromeTabs(await this.deps.enumerate());
      for (const p of projects) {
        const t = matchTab(p, tabs);
        if (t) {
          this.store.setBrowser(p.id, { tabOpen: true, ref: { windowIndex: t.windowIndex, tabIndex: t.tabIndex } });
          seen.push(p.id);
        }
      }
    } catch { /* AppleScript failed / Chrome closed — nothing open */ }
    this.store.clearBrowserExcept(seen);
  }
}

// Real enumerator (used in index.ts). Emits wi|ti|url rows.
const ENUM_SCRIPT = `tell application "Google Chrome"
  set out to {}
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      set end of out to (wi & "|" & ti & "|" & (URL of t))
    end repeat
  end repeat
  set AppleScript's text item delimiters to linefeed
  return out as text
end tell`;

export const realChromeDeps: ChromeDetectorDeps = {
  enumerate: async () =>
    (await Bun.$`osascript -e ${ENUM_SCRIPT}`.quiet().nothrow()).stdout.toString(),
};
```

- [ ] **Step 4: Run the test, verify it passes** — `cd daemon && bun test test/detect-chrome.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/detect-chrome.ts daemon/test/detect-chrome.test.ts
git commit -m "feat(daemon): Chrome tab detector (AppleScript parse + match)"
```

---

## Task 4: Fold detection into `buildProjectViews`

**Files:**
- Modify: `daemon/src/derive.ts`
- Test: `daemon/test/derive.test.ts` (extend)

**Interfaces:**
- Changes `buildProjectViews(projects, sessions)` → `buildProjectViews(projects, sessions, detection?: DetectionStore)`. When `detection` is provided, fill `dev` from `detection.getDev(project.id)` and `browser` from `detection.getBrowser(project.id)`. When omitted (back-compat for existing tests), keep the current stub defaults. Consumes `DetectionStore` from detection.ts.

- [ ] **Step 1: Add the failing test to `daemon/test/derive.test.ts`**

```ts
import { DetectionStore } from "../src/detection";

test("buildProjectViews fills dev/browser from detection store", () => {
  const detection = new DetectionStore();
  detection.setDev("web", { running: true, port: 3000, pid: 5, managed: false });
  detection.setBrowser("web", { tabOpen: true, ref: { windowIndex: 1, tabIndex: 1 } });
  const views = buildProjectViews([proj("web")], [], detection);
  expect(views[0].dev).toEqual({ running: true, port: 3000, pid: 5, managed: false });
  expect(views[0].browser).toEqual({ tabOpen: true, ref: { windowIndex: 1, tabIndex: 1 } });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd daemon && bun test test/derive.test.ts` → the new test FAILs (3rd arg ignored).

- [ ] **Step 3: Modify `buildProjectViews` in `daemon/src/derive.ts`**

Change the signature and the `dev`/`browser` lines:

```ts
import type { DetectionStore } from "./detection";

export function buildProjectViews(
  projects: Project[],
  sessions: Session[],
  detection?: DetectionStore,
): ProjectView[] {
  return projects.map((project) => {
    const mine = sessions.filter((s) => s.projectId === project.id && s.status !== "gone");
    const h = headline(mine.map((s) => s.status));
    const dev = detection
      ? detection.getDev(project.id)
      : { running: false, port: project.port, pid: null, managed: false };
    const browser = detection ? detection.getBrowser(project.id) : { tabOpen: false, ref: null };
    return {
      project,
      claude: {
        count: mine.length,
        headline: h,
        needsAttention: mine.length > 0 && isNeedsAttention(h),
        sessions: mine.map((s) => ({
          sessionId: s.sessionId, status: s.status, detail: s.detail,
          model: s.model, contextPct: s.contextPct,
        })),
      },
      dev,
      browser,
    };
  });
}
```

- [ ] **Step 4: Run the full derive suite, verify pass** — `cd daemon && bun test test/derive.test.ts` → PASS (old + new).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/derive.ts daemon/test/derive.test.ts
git commit -m "feat(daemon): fold detection store into ProjectView"
```

---

## Task 5: Wire detectors + registry CRUD into the daemon

**Files:**
- Modify: `daemon/src/index.ts`
- Test: `daemon/test/projects-api.test.ts`

**Interfaces:**
- Adds routes: `GET /projects` → `Project[]`; `POST /projects` (body `Project`) → 201 `Project`; `PUT /projects/:id` (body `Partial<Project>`) → `Project`; `DELETE /projects/:id` → `{ ok: true }`; `POST /actions/chrome/refresh` → triggers a `ChromeDetector.refresh` then `{ ok: true }`. Wires `DetectionStore` into the module singletons, passes it to `buildProjectViews` in `GET /state`, starts `PortDetector` on boot, and exposes `__setStores` to also inject a `DetectionStore`. Consumes Registry/SessionStore/DetectionStore/detectors.

- [ ] **Step 1: Write the failing test `daemon/test/projects-api.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails** — `cd daemon && bun test test/projects-api.test.ts` → FAIL.

- [ ] **Step 3: Modify `daemon/src/index.ts`** — update `__setStores`, add a module `detection`, the CRUD routes, the chrome-refresh action, pass `detection` to `buildProjectViews`, and start the port detector on boot. Add near the other imports/singletons:

```ts
import { DetectionStore } from "./detection";
import { PortDetector, realPortDeps } from "./detect-ports";
import { ChromeDetector, realChromeDeps } from "./detect-chrome";
import type { Project } from "./types";

let detection = new DetectionStore();
export function __setStores(r: Registry, s: SessionStore, d?: DetectionStore) {
  registry = r; store = s; if (d) detection = d;
}
```

Change `/state` to: `app.get("/state", (c) => c.json(buildProjectViews(registry.list(), store.all(), detection)));`

Add the routes:

```ts
app.get("/projects", (c) => c.json(registry.list()));
app.post("/projects", async (c) => {
  const p = (await c.req.json()) as Project;
  await registry.add(p);
  return c.json(p, 201);
});
app.put("/projects/:id", async (c) => {
  const patch = (await c.req.json()) as Partial<Project>;
  const updated = await registry.update(c.req.param("id"), patch);
  return c.json(updated);
});
app.delete("/projects/:id", async (c) => {
  await registry.remove(c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/actions/chrome/refresh", async (c) => {
  await new ChromeDetector(detection, realChromeDeps).refresh(registry.list());
  return c.json({ ok: true });
});
```

In the `if (import.meta.main)` block, after `startWatchdog(store)`:

```ts
  const portDetector = new PortDetector(detection, realPortDeps);
  portDetector.start(() => registry.list(), 4000);
```

- [ ] **Step 4: Run the projects-api test + full suite** — `cd daemon && bun test` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/index.ts daemon/test/projects-api.test.ts
git commit -m "feat(daemon): registry CRUD routes + detector wiring"
```

---

## Task 6: Pure UI formatters (bar title + tray menu)

**Files:**
- Create: `ui/src/bun/format.ts`
- Test: `ui/test/format.test.ts`

**Interfaces:**
- Consumes: a structural `ProjectView` (declare a local minimal type matching the daemon's `GET /state` JSON — UI does not import daemon code).
- Produces: `DOT: Record<ClaudeStatus,string>` emoji map; `sortViews(views): ProjectView[]` (urgency order using the same priority as the daemon); `formatBarTitle(views): string` → `"🔴2 🟡1 🔵3 ┃ 🔴iris 🟡pay 🔵mktg"` (B summary of needs/working/idle counts, then A per-project dot+name, urgency-sorted; empty → `"projflow"`); `buildTrayMenu(views): MenuItemConfig[]` → per-project disabled header (`"🔴 iris — blocked_permission · :3000 · tab"`) then a divider, then `Settings…` (action `"settings"`) and `Quit` (action `"quit"`).

- [ ] **Step 1: Create `ui/test/format.test.ts` (failing)**

```ts
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
  expect(formatBarTitle([])).toBe("projflow");
});

test("buildTrayMenu has a disabled header per project, a divider, Settings and Quit", () => {
  const menu = buildTrayMenu([v("iris","blocked_permission",{port:3000,tab:true})]);
  expect(menu[0]).toMatchObject({ enabled: false });
  expect(menu[0].label).toContain("iris");
  expect(menu[0].label).toContain("3000");
  expect(menu.some((m) => m.action === "settings")).toBe(true);
  expect(menu.some((m) => m.action === "quit")).toBe(true);
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd ui && bun test test/format.test.ts` → FAIL.

- [ ] **Step 3: Create `ui/src/bun/format.ts`**

```ts
export type ClaudeStatus =
  | "idle" | "working" | "blocked_permission" | "blocked_input"
  | "error" | "compacting" | "gone";

export interface ProjectView {
  project: { id: string; name: string; port: number | null; url: string | null };
  claude: { count: number; headline: ClaudeStatus; needsAttention: boolean; sessions: unknown[] };
  dev: { running: boolean; port: number | null; pid: number | null; managed: boolean };
  browser: { tabOpen: boolean; ref: unknown };
}

export interface MenuItemConfig {
  label?: string; action?: string; type?: "normal" | "divider";
  enabled?: boolean; submenu?: MenuItemConfig[];
}

const PRIORITY: ClaudeStatus[] = [
  "blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone",
];
export const DOT: Record<ClaudeStatus, string> = {
  blocked_permission: "🔴", error: "🔴", blocked_input: "🔴",
  compacting: "🟣", working: "🟡", idle: "🔵", gone: "⚪",
};

export function sortViews(views: ProjectView[]): ProjectView[] {
  return [...views].sort(
    (a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline),
  );
}

export function formatBarTitle(views: ProjectView[]): string {
  if (views.length === 0) return "projflow";
  const needs = views.filter((v) => v.claude.needsAttention).length;
  const working = views.filter((v) => v.claude.headline === "working" || v.claude.headline === "compacting").length;
  const idle = views.filter((v) => v.claude.headline === "idle" || v.claude.headline === "gone").length;
  const summary = `🔴${needs} 🟡${working} 🔵${idle}`;
  const list = sortViews(views).map((v) => `${DOT[v.claude.headline]}${v.project.name}`).join(" ");
  return `${summary} ┃ ${list}`;
}

export function buildTrayMenu(views: ProjectView[]): MenuItemConfig[] {
  const menu: MenuItemConfig[] = [];
  for (const v of sortViews(views)) {
    const bits = [DOT[v.claude.headline] + " " + v.project.name, v.claude.headline];
    if (v.dev.running && v.dev.port) bits.push(`:${v.dev.port}`);
    if (v.browser.tabOpen) bits.push("tab");
    menu.push({ label: bits.join(" · "), enabled: false });
  }
  menu.push({ type: "divider" });
  menu.push({ label: "Settings…", action: "settings" });
  menu.push({ label: "Quit projflow", action: "quit" });
  return menu;
}
```

- [ ] **Step 4: Run the test, verify it passes** — `cd ui && bun test test/format.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/bun/format.ts ui/test/format.test.ts
git commit -m "feat(ui): pure bar-title + tray-menu formatters"
```

---

## Task 7: Electrobun config + HTTP client

**Files:**
- Create: `ui/electrobun.config.ts`, `ui/src/bun/api.ts`
- Modify: `ui/package.json` (scripts)

**Interfaces:**
- Produces: `ui/src/bun/api.ts` exporting `const DAEMON = "http://127.0.0.1:7777"`; `fetchState(): Promise<ProjectView[]>` (returns `[]` on any error); `listProjects()`, `createProject(p)`, `updateProject(id, patch)`, `deleteProject(id)`, `refreshChrome()`. No test (network/IO wrappers; covered by manual run).

- [ ] **Step 1: Create `ui/electrobun.config.ts`**

```ts
import { defineConfig } from "electrobun";

export default defineConfig({
  app: { name: "projflow", identifier: "sh.projflow.app", version: "0.1.0" },
  build: {
    bun: { entrypoint: "src/bun/main.ts" },
    views: { settings: { entrypoint: "src/views/settings/index.ts" } },
    copy: { "src/views/settings/index.html": "views/settings/index.html" },
  },
});
```

- [ ] **Step 2: Create `ui/src/bun/api.ts`**

```ts
import type { ProjectView } from "./format";

export const DAEMON = "http://127.0.0.1:7777";

async function j<T>(p: Promise<Response>, fallback: T): Promise<T> {
  try { const r = await p; return (await r.json()) as T; } catch { return fallback; }
}

export const fetchState = () => j<ProjectView[]>(fetch(`${DAEMON}/state`), []);
export const listProjects = () => j<any[]>(fetch(`${DAEMON}/projects`), []);
export const createProject = (p: any) =>
  j(fetch(`${DAEMON}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }), null);
export const updateProject = (id: string, patch: any) =>
  j(fetch(`${DAEMON}/projects/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }), null);
export const deleteProject = (id: string) => j(fetch(`${DAEMON}/projects/${id}`, { method: "DELETE" }), null);
export const refreshChrome = () => j(fetch(`${DAEMON}/actions/chrome/refresh`, { method: "POST" }), null);
```

- [ ] **Step 3: Update `ui/package.json` scripts** — ensure:

```json
{
  "scripts": {
    "dev": "electrobun dev",
    "build": "electrobun build",
    "test": "bun test"
  }
}
```

- [ ] **Step 4: Type-check** — `cd ui && bunx tsc --noEmit --skipLibCheck src/bun/api.ts src/bun/format.ts` → no errors.

- [ ] **Step 5: Commit**

```bash
git add ui/electrobun.config.ts ui/src/bun/api.ts ui/package.json
git commit -m "feat(ui): electrobun config + daemon HTTP client"
```

---

## Task 8: Tray main process + Settings webview

**Files:**
- Create: `ui/src/bun/main.ts`, `ui/src/views/settings/index.html`, `ui/src/views/settings/index.ts`

**Interfaces:**
- `main.ts`: on start, create a `Tray`, immediately render once, then `setInterval` poll `fetchState()` every 1000ms → `tray.setTitle(formatBarTitle(views))`; on `tray-clicked` rebuild `tray.setMenu(buildTrayMenu(views))` and handle the `action`: `"settings"` opens/ff focuses the Settings `BrowserWindow`; `"quit"` → `process.exit(0)`.
- `settings`: HTML list + add-form; `index.ts` uses `api.ts` CRUD to render and mutate the registry, calling the daemon directly over HTTP.
- No automated test (native runtime); verified in Task 9 manual run.

- [ ] **Step 1: Create `ui/src/bun/main.ts`**

```ts
import { Tray, BrowserWindow } from "electrobun/bun";
import { fetchState } from "./api";
import { formatBarTitle, buildTrayMenu } from "./format";

let latest = await fetchState();
const tray = new Tray({ title: formatBarTitle(latest) });

let settingsWin: BrowserWindow | null = null;
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    title: "projflow · Settings",
    url: "views://settings/index.html",
    frame: { width: 520, height: 460, x: 200, y: 200 },
  });
  settingsWin.on("close", () => { settingsWin = null; });
}

tray.on("tray-clicked", (e: any) => {
  tray.setMenu(buildTrayMenu(latest));
  const action = e?.action ?? e?.data?.action ?? "";
  if (action === "settings") openSettings();
  else if (action === "quit") process.exit(0);
});

setInterval(async () => {
  latest = await fetchState();
  tray.setTitle(formatBarTitle(latest));
}, 1000);
```

- [ ] **Step 2: Create `ui/src/views/settings/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>projflow · Settings</title>
    <style>
      body { font: 13px -apple-system, sans-serif; margin: 0; padding: 14px; }
      h1 { font-size: 14px; margin: 0 0 10px; }
      .row { border-top: 1px solid #ddd; padding: 8px 0; }
      input { font: inherit; padding: 3px 5px; margin: 2px; }
      button { font: inherit; }
      .muted { color: #888; }
    </style>
  </head>
  <body>
    <h1>Registered projects</h1>
    <div id="list"></div>
    <div class="row">
      <input id="name" placeholder="name" size="10" />
      <input id="path" placeholder="/abs/path" size="22" />
      <input id="cmd" placeholder="pnpm dev" size="9" />
      <input id="port" placeholder="port" size="5" />
      <button id="add">Add</button>
    </div>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `ui/src/views/settings/index.ts`**

```ts
import { listProjects, createProject, deleteProject } from "../../bun/api";

const el = (id: string) => document.getElementById(id) as HTMLInputElement;

async function render() {
  const projects = await listProjects();
  const list = document.getElementById("list")!;
  list.innerHTML = "";
  for (const p of projects) {
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `<b>${p.name}</b> <span class="muted">${p.path}</span> · ${p.devCommand}` +
      `${p.port ? " · :" + p.port : ""} `;
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = async () => { await deleteProject(p.id); render(); };
    div.appendChild(del);
    list.appendChild(div);
  }
}

document.getElementById("add")!.addEventListener("click", async () => {
  const name = el("name").value.trim();
  const path = el("path").value.trim();
  if (!name || !path) return;
  const port = el("port").value ? Number(el("port").value) : null;
  await createProject({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name, path, devCommand: el("cmd").value.trim() || "pnpm dev",
    port, url: port ? `http://localhost:${port}` : null, enabled: true,
  });
  for (const f of ["name","path","cmd","port"]) el(f).value = "";
  render();
});

render();
```

- [ ] **Step 4: Type-check the UI sources** — `cd ui && bunx tsc --noEmit --skipLibCheck` → no errors. (Tray/BrowserWindow types come from electrobun.)

- [ ] **Step 5: Commit**

```bash
git add ui/src/bun/main.ts ui/src/views/settings/index.html ui/src/views/settings/index.ts
git commit -m "feat(ui): tray main process + settings webview"
```

---

## Task 9: Manual run + verification (with user)

**Files:** none (verification). Confirms the menu bar renders and reflects live state.

- [ ] **Step 1: Run the full daemon + UI test suites** — `cd daemon && bun test` (all pass) and `cd ui && bun test` (format tests pass).
- [ ] **Step 2: Start the daemon** — `cd daemon && bun run start` (or confirm one is already running on 7777).
- [ ] **Step 3: Ensure at least one project is registered** (Settings UI, or `~/Library/Application Support/projflow/projects.json`).
- [ ] **Step 4: Launch the menu-bar app** — `cd ui && bun run dev`. Expected: an Electrobun build/run; a projflow item appears in the macOS menu bar showing the A+B row (e.g. `🔴0 🟡0 🔵1 ┃ 🔵<project>`).
- [ ] **Step 5: Drive a real Claude turn** in a registered project and watch the bar flip 🔵→🟡→(🔴 on a permission prompt)→🔵 within ~1s, mirroring `curl localhost:7777/state`.
- [ ] **Step 6: Start a dev server** (`pnpm dev`) in a registered project; within ~4s its row gains `:port` (lsof detection). Open its localhost URL in Chrome, click the tray (triggers chrome refresh in Phase 3; in Phase 2 call `curl -XPOST localhost:7777/actions/chrome/refresh`) and confirm the dropdown header shows `tab`.
- [ ] **Step 7: Open Settings…** from the dropdown; add and delete a project; confirm the bar updates.
- [ ] **Step 8: Grant macOS Automation permission** when prompted (System Settings → Privacy & Security → Automation) so Chrome enumeration works; note in README which prompt appeared.
- [ ] **Step 9: Document run steps** in `ui/README.md` and commit.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §3 inline A+B row (Task 6 `formatBarTitle`), native dropdown menu (Task 6 `buildTrayMenu` + Task 8 `setMenu`), §3.3 setTitle/setMenu/tray-clicked (Task 8), §3.2 settings webview (Task 8), §6 lsof detection (Task 2), Chrome AppleScript detect (Task 3), detection folded into ProjectView (Task 4), registry CRUD endpoints (Task 5). Global signal = the emoji summary in the bar (Task 6).
- **Out of scope (Phase 3):** row actions (dev start/stop, browser open/focus, editor focus), managed dev servers, the `:9222` CDP alternative. Phase 4: transcript tokens/context%, bundling projd into the app for TCC, SSE.
- **Placeholder scan:** none — complete code for every step. The Electrobun tray-clicked event shape is read defensively (`e.action ?? e.data?.action`) since the runtime payload wasn't asserted in a test; Task 9 Step 4 confirms it live.
- **Type consistency:** UI declares its own structural `ProjectView`/`MenuItemConfig` (no daemon import); `DetectionStore`/`DevInfo`/`BrowserInfo` names match across detection.ts, detect-ports.ts, detect-chrome.ts, derive.ts, index.ts; `__setStores` 3rd arg threaded through Task 5 tests.
```
