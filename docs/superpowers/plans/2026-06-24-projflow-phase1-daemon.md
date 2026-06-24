# projflow Phase 1 — Daemon Core & Hook Signal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `projd` daemon so a real Claude Code session's lifecycle is captured via hooks and exposed at `GET /state` as a per-project "which session needs me" signal — no UI, no actions yet.

**Architecture:** A Bun + Hono HTTP daemon on `127.0.0.1:7777`. Claude Code hooks POST to `/hook`; the daemon resolves each event to a session (by `session_id`) and a project (by `cwd`, longest-prefix), applies a **pure** state-machine transition, and derives `ProjectView[]` for `GET /state`. State lives in memory, mirrored to JSON files for crash recovery. A hooks installer merges projflow's HTTP hooks into `~/.claude/settings.json`.

**Tech Stack:** Bun 1.3.10, Hono (HTTP), TypeScript, `bun:test` (test runner). No other runtime deps in Phase 1.

## Global Constraints

- **Platform:** macOS 14+ only. Bun `1.3.10` (already installed).
- **Daemon bind:** `127.0.0.1` only, default port `7777`, configurable via `PROJFLOW_PORT` env.
- **`POST /hook` MUST return 200 instantly** and do state work synchronously-but-cheaply (no I/O blocking the response beyond an in-memory map write + throttled file mirror). A down daemon must never break Claude Code (hooks are non-blocking HTTP).
- **Join key is the absolute project path.** Resolve `cwd → project` by **longest-prefix match** against `project.path`.
- **Status enum (exact strings):** `idle | working | blocked_permission | blocked_input | error | compacting | gone`.
- **Headline priority:** `blocked_permission > error > blocked_input > compacting > working > idle > gone`. `needsAttention = headline ∈ {blocked_permission, blocked_input, error}`.
- **Data dir:** `~/Library/Application Support/projflow/` (`projects.json`, `sessions.json`, `logs/`). Override with `PROJFLOW_DATA_DIR` env (tests set this to a temp dir).
- **Hook installer tag:** every injected hook entry carries `"description"` starting with `projflow:` so uninstall filters cleanly. Never clobber existing user hooks.
- **Hooks registered (15, skip `MessageDisplay`):** `SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolBatch, PermissionRequest, Notification, Stop, StopFailure, PostToolUseFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, SessionEnd`.

---

## Step 0 (BLOCKING, manual — do before any task): verify hooks fire from the VSCode extension

The entire input path depends on Claude Code hooks reaching the daemon. Verify the VSCode Claude extension fires user-level `~/.claude/settings.json` hooks.

- [ ] **0.1** Ask the user to approve adding a temporary hook to `~/.claude/settings.json` (auto-mode blocks self-modification of settings, so this needs explicit approval). Add:

```json
"hooks": {
  "Stop": [
    { "matcher": "", "hooks": [
      { "type": "command", "command": "echo \"projflow-test Stop $(date)\" >> /tmp/projflow-hook-test.log" }
    ]}
  ],
  "UserPromptSubmit": [
    { "matcher": "", "hooks": [
      { "type": "command", "command": "echo \"projflow-test UserPromptSubmit $(date)\" >> /tmp/projflow-hook-test.log" }
    ]}
  ]
}
```

- [ ] **0.2** In the VSCode Claude extension panel, run one short turn (submit a prompt, let it stop).
- [ ] **0.3** Run `cat /tmp/projflow-hook-test.log`. Expected: lines for both `UserPromptSubmit` and `Stop`.
- [ ] **0.4 Decide the target mode:**
  - If the log has entries → **extension fires hooks**; proceed, user-level install covers all projects.
  - If empty → **fallback**: the build targets running `claude` in VSCode's **integrated terminal** (fires every hook). Record this in the plan; everything else is unchanged.
- [ ] **0.5** Remove the temporary hook from `~/.claude/settings.json` (the real installer in Task 10 adds the proper HTTP hooks).

---

## File Structure (Phase 1)

```
daemon/
  package.json                 # bun project, scripts, hono dep
  tsconfig.json
  src/
    config.ts                  # paths, port, data dir resolution
    types.ts                   # Project, Session, DevServer, ProjectView, ClaudeStatus, hook payloads
    registry.ts                # projects.json CRUD (class Registry)
    resolve.ts                 # longestPrefixMatch(cwd, projects) -> projectId|null
    state-machine.ts           # pure transition(session, event) -> session
    sessions.ts                # SessionStore: in-memory map + sessions.json mirror
    derive.ts                  # headline(), needsAttention(), buildProjectViews()
    hooks.ts                   # handleHook(payload, deps): applies a hook to state
    watchdog.ts                # Watchdog: pid polling + heartbeat timeouts (injectable clock/pidAlive)
    index.ts                   # Hono app wiring: POST /hook, GET /state, GET /health; starts watchdog
  hooks/
    install.ts                 # merge projflow HTTP hooks into ~/.claude/settings.json
    uninstall.ts               # remove projflow: tagged hooks
  test/
    registry.test.ts
    resolve.test.ts
    state-machine.test.ts
    sessions.test.ts
    derive.test.ts
    hooks.test.ts
    watchdog.test.ts
    install.test.ts
    server.test.ts             # integration: POST /hook -> GET /state
```

---

## Task 1: Project scaffold + health endpoint

**Files:**
- Create: `daemon/package.json`, `daemon/tsconfig.json`, `daemon/src/config.ts`, `daemon/src/index.ts`
- Test: `daemon/test/server.test.ts` (health only for now)

**Interfaces:**
- Produces: `config` object `{ port: number; dataDir: string; projectsFile: string; sessionsFile: string; logsDir: string }` from `src/config.ts`; a Hono `app` exported from `src/index.ts`.

- [ ] **Step 1: Create `daemon/package.json`**

```json
{
  "name": "projd",
  "module": "src/index.ts",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "install-hooks": "bun run hooks/install.ts",
    "uninstall-hooks": "bun run hooks/uninstall.ts"
  },
  "dependencies": { "hono": "^4.6.0" },
  "devDependencies": { "@types/bun": "latest" }
}
```

- [ ] **Step 2: Create `daemon/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

- [ ] **Step 3: Install deps**

Run: `cd daemon && bun install`
Expected: `hono` and `@types/bun` resolve; `node_modules/` created.

- [ ] **Step 4: Create `daemon/src/config.ts`**

```ts
import { homedir } from "os";
import { join } from "path";

const defaultDataDir = join(homedir(), "Library", "Application Support", "projflow");
const dataDir = process.env.PROJFLOW_DATA_DIR ?? defaultDataDir;

export const config = {
  port: Number(process.env.PROJFLOW_PORT ?? 7777),
  dataDir,
  projectsFile: join(dataDir, "projects.json"),
  sessionsFile: join(dataDir, "sessions.json"),
  logsDir: join(dataDir, "logs"),
};
```

- [ ] **Step 5: Write the failing test `daemon/test/server.test.ts`**

```ts
import { test, expect } from "bun:test";
import { app } from "../src/index";

test("GET /health returns ok", async () => {
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `cd daemon && bun test test/server.test.ts`
Expected: FAIL — cannot import `app` from `../src/index` (module/empty).

- [ ] **Step 7: Create `daemon/src/index.ts`**

```ts
import { Hono } from "hono";
import { config } from "./config";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// Only listen when run directly, not when imported by tests.
if (import.meta.main) {
  Bun.serve({ port: config.port, hostname: "127.0.0.1", fetch: app.fetch });
  console.log(`projd listening on http://127.0.0.1:${config.port}`);
}
```

- [ ] **Step 8: Run the test, verify it passes**

Run: `cd daemon && bun test test/server.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add daemon/package.json daemon/tsconfig.json daemon/src/config.ts daemon/src/index.ts daemon/test/server.test.ts
git commit -m "feat(daemon): scaffold Bun+Hono daemon with /health"
```

---

## Task 2: Core types

**Files:**
- Create: `daemon/src/types.ts`
- Test: none (type-only module; consumed and thus compiled by later tests)

**Interfaces:**
- Produces: `ClaudeStatus`, `Project`, `Session`, `DevServer`, `ProjectView`, `HookPayload`.

- [ ] **Step 1: Create `daemon/src/types.ts`**

```ts
export type ClaudeStatus =
  | "idle" | "working" | "blocked_permission" | "blocked_input"
  | "error" | "compacting" | "gone";

export interface Project {
  id: string;
  name: string;
  path: string;          // absolute dir — the join key
  devCommand: string;
  port: number | null;
  url: string | null;
  enabled: boolean;
}

export interface Session {
  sessionId: string;
  cwd: string;
  projectId: string | null;
  status: ClaudeStatus;
  detail: string | null;
  pid: number | null;
  subagents: number;
  model: string | null;
  tokens: { input: number; output: number; total: number } | null;
  contextPct: number | null;
  transcriptPath: string | null;
  lastEventAt: number;   // epoch ms
  lastEvent: string;
}

export interface DevServer {
  projectId: string;
  pid: number | null;
  port: number | null;
  status: "starting" | "running" | "stopped" | "crashed";
  startedAt: number | null;
  logFile: string;
  managed: boolean;
}

export interface ProjectView {
  project: Project;
  claude: {
    count: number;
    headline: ClaudeStatus;
    needsAttention: boolean;
    sessions: Pick<Session, "sessionId" | "status" | "detail" | "model" | "contextPct">[];
  };
  dev: { running: boolean; port: number | null; pid: number | null; managed: boolean };
  browser: { tabOpen: boolean; ref: { windowIndex: number; tabIndex: number } | null };
}

// Raw Claude Code hook payload (only the fields Phase 1 reads).
export interface HookPayload {
  hook_event_name: string;        // e.g. "PreToolUse"
  session_id: string;
  cwd: string;
  transcript_path?: string;
  pid?: number;
  tool_name?: string;
  notification?: { type?: string; [k: string]: unknown };
  error?: { subtype?: string; [k: string]: unknown };
  [k: string]: unknown;
}
```

- [ ] **Step 2: Type-check**

Run: `cd daemon && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add daemon/src/types.ts
git commit -m "feat(daemon): add core domain types"
```

---

## Task 3: Longest-prefix cwd → project resolver

**Files:**
- Create: `daemon/src/resolve.ts`
- Test: `daemon/test/resolve.test.ts`

**Interfaces:**
- Consumes: `Project` from `types.ts`.
- Produces: `resolveProjectId(cwd: string, projects: Project[]): string | null`.

- [ ] **Step 1: Write the failing test `daemon/test/resolve.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd daemon && bun test test/resolve.test.ts`
Expected: FAIL — `resolveProjectId` not defined.

- [ ] **Step 3: Create `daemon/src/resolve.ts`**

```ts
import type { Project } from "./types";

/** Longest-prefix match of cwd against project.path, on path-segment boundaries. */
export function resolveProjectId(cwd: string, projects: Project[]): string | null {
  const norm = (p: string) => (p.endsWith("/") ? p.slice(0, -1) : p);
  const c = norm(cwd);
  let best: Project | null = null;
  for (const p of projects) {
    const base = norm(p.path);
    if (c === base || c.startsWith(base + "/")) {
      if (!best || base.length > norm(best.path).length) best = p;
    }
  }
  return best ? best.id : null;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd daemon && bun test test/resolve.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/resolve.ts daemon/test/resolve.test.ts
git commit -m "feat(daemon): longest-prefix cwd->project resolver"
```

---

## Task 4: Registry (projects.json CRUD)

**Files:**
- Create: `daemon/src/registry.ts`
- Test: `daemon/test/registry.test.ts`

**Interfaces:**
- Consumes: `Project` from `types.ts`.
- Produces: `class Registry` with `constructor(filePath: string)`, `async load(): Promise<void>`, `list(): Project[]`, `get(id): Project | undefined`, `async add(p: Project): Promise<void>`, `async update(id, patch: Partial<Project>): Promise<Project>`, `async remove(id): Promise<void>`.

- [ ] **Step 1: Write the failing test `daemon/test/registry.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd daemon && bun test test/registry.test.ts`
Expected: FAIL — `Registry` not defined.

- [ ] **Step 3: Create `daemon/src/registry.ts`**

```ts
import { mkdir } from "fs/promises";
import { dirname } from "path";
import type { Project } from "./types";

export class Registry {
  private projects = new Map<string, Project>();
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    const f = Bun.file(this.filePath);
    if (await f.exists()) {
      const arr = (await f.json()) as Project[];
      this.projects = new Map(arr.map((p) => [p.id, p]));
    }
  }

  list(): Project[] { return [...this.projects.values()]; }
  get(id: string): Project | undefined { return this.projects.get(id); }

  async add(p: Project): Promise<void> { this.projects.set(p.id, p); await this.save(); }

  async update(id: string, patch: Partial<Project>): Promise<Project> {
    const cur = this.projects.get(id);
    if (!cur) throw new Error(`no project ${id}`);
    const next = { ...cur, ...patch, id: cur.id };
    this.projects.set(id, next);
    await this.save();
    return next;
  }

  async remove(id: string): Promise<void> { this.projects.delete(id); await this.save(); }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await Bun.write(this.filePath, JSON.stringify(this.list(), null, 2));
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd daemon && bun test test/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/registry.ts daemon/test/registry.test.ts
git commit -m "feat(daemon): project registry CRUD with JSON persistence"
```

---

## Task 5: State machine (pure transition) — the core logic

**Files:**
- Create: `daemon/src/state-machine.ts`
- Test: `daemon/test/state-machine.test.ts`

**Interfaces:**
- Consumes: `Session`, `ClaudeStatus`, `HookPayload` from `types.ts`.
- Produces: `newSession(sessionId, cwd, now): Session`; `transition(session: Session, payload: HookPayload, now: number): Session` — pure, returns a new Session (never mutates input).

- [ ] **Step 1: Write the failing test `daemon/test/state-machine.test.ts`**

```ts
import { test, expect } from "bun:test";
import { newSession, transition } from "../src/state-machine";
import type { HookPayload } from "../src/types";

const ev = (name: string, extra: Partial<HookPayload> = {}): HookPayload =>
  ({ hook_event_name: name, session_id: "s1", cwd: "/dev/web", ...extra });

const base = () => newSession("s1", "/dev/web", 1000);

test("SessionStart captures pid + transcript and is idle", () => {
  const s = transition(base(), ev("SessionStart", { pid: 42, transcript_path: "/t.jsonl" }), 1001);
  expect(s.status).toBe("idle");
  expect(s.pid).toBe(42);
  expect(s.transcriptPath).toBe("/t.jsonl");
});

test("UserPromptSubmit -> working and clears detail", () => {
  const s = transition({ ...base(), detail: "old" }, ev("UserPromptSubmit"), 1002);
  expect(s.status).toBe("working");
  expect(s.detail).toBeNull();
});

test("PreToolUse -> working with tool name in detail", () => {
  const s = transition(base(), ev("PreToolUse", { tool_name: "Bash" }), 1003);
  expect(s.status).toBe("working");
  expect(s.detail).toBe("Bash");
});

test("PermissionRequest -> blocked_permission", () => {
  expect(transition(base(), ev("PermissionRequest"), 1).status).toBe("blocked_permission");
});

test("Notification permission_prompt -> blocked_permission", () => {
  const s = transition(base(), ev("Notification", { notification: { type: "permission_prompt" } }), 1);
  expect(s.status).toBe("blocked_permission");
});

test("Notification idle_prompt -> blocked_input", () => {
  const s = transition(base(), ev("Notification", { notification: { type: "idle_prompt" } }), 1);
  expect(s.status).toBe("blocked_input");
});

test("Notification elicitation_dialog -> blocked_input with MCP detail", () => {
  const s = transition(base(), ev("Notification", { notification: { type: "elicitation_dialog" } }), 1);
  expect(s.status).toBe("blocked_input");
  expect(s.detail).toBe("MCP input");
});

test("Notification auth_success is ignored (status unchanged)", () => {
  const start = transition(base(), ev("UserPromptSubmit"), 1);
  const s = transition(start, ev("Notification", { notification: { type: "auth_success" } }), 2);
  expect(s.status).toBe("working");
});

test("Stop -> idle", () => {
  const w = transition(base(), ev("UserPromptSubmit"), 1);
  expect(transition(w, ev("Stop"), 2).status).toBe("idle");
});

test("StopFailure -> error with subtype detail", () => {
  const s = transition(base(), ev("StopFailure", { error: { subtype: "rate_limit" } }), 1);
  expect(s.status).toBe("error");
  expect(s.detail).toBe("rate_limit");
});

test("Subagent start/stop adjusts count and detail", () => {
  let s = transition(base(), ev("UserPromptSubmit"), 1);
  s = transition(s, ev("SubagentStart"), 2);
  expect(s.subagents).toBe(1);
  expect(s.detail).toBe("working, 1 agents");
  s = transition(s, ev("SubagentStop"), 3);
  expect(s.subagents).toBe(0);
});

test("PreCompact -> compacting, PostCompact -> working", () => {
  const c = transition(base(), ev("PreCompact"), 1);
  expect(c.status).toBe("compacting");
  expect(transition(c, ev("PostCompact"), 2).status).toBe("working");
});

test("SessionEnd -> gone", () => {
  expect(transition(base(), ev("SessionEnd"), 1).status).toBe("gone");
});

test("every event bumps lastEventAt and records lastEvent, without mutating input", () => {
  const s0 = base();
  const s1 = transition(s0, ev("PreToolUse", { tool_name: "Read" }), 9999);
  expect(s1.lastEventAt).toBe(9999);
  expect(s1.lastEvent).toBe("PreToolUse");
  expect(s0.lastEventAt).toBe(1000); // input untouched
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd daemon && bun test test/state-machine.test.ts`
Expected: FAIL — `newSession`/`transition` not defined.

- [ ] **Step 3: Create `daemon/src/state-machine.ts`**

```ts
import type { Session, ClaudeStatus, HookPayload } from "./types";

export function newSession(sessionId: string, cwd: string, now: number): Session {
  return {
    sessionId, cwd, projectId: null, status: "idle", detail: null, pid: null,
    subagents: 0, model: null, tokens: null, contextPct: null, transcriptPath: null,
    lastEventAt: now, lastEvent: "init",
  };
}

/** Pure: returns a new Session reflecting the hook event. Never mutates input. */
export function transition(session: Session, payload: HookPayload, now: number): Session {
  const s: Session = { ...session, lastEventAt: now, lastEvent: payload.hook_event_name };
  const set = (status: ClaudeStatus, detail: string | null = s.detail) => { s.status = status; s.detail = detail; };

  switch (payload.hook_event_name) {
    case "SessionStart":
      if (payload.pid != null) s.pid = payload.pid;
      if (payload.transcript_path) s.transcriptPath = payload.transcript_path;
      set("idle", null);
      break;
    case "UserPromptSubmit": set("working", null); break;
    case "PreToolUse": set("working", payload.tool_name ?? null); break;
    case "PostToolUse":
    case "PostToolBatch": set("working"); break;
    case "PostToolUseFailure": s.detail = `error: ${payload.error?.subtype ?? "tool failed"}`; break;
    case "PermissionRequest": set("blocked_permission"); break;
    case "Notification": {
      const t = payload.notification?.type;
      if (t === "permission_prompt") set("blocked_permission");
      else if (t === "idle_prompt") set("blocked_input");
      else if (t === "elicitation_dialog") set("blocked_input", "MCP input");
      // else ignore
      break;
    }
    case "Stop": set("idle"); break;
    case "StopFailure": set("error", payload.error?.subtype ?? "error"); break;
    case "SubagentStart": s.subagents += 1; set("working", `working, ${s.subagents} agents`); break;
    case "SubagentStop": s.subagents = Math.max(0, s.subagents - 1); break;
    case "PreCompact": set("compacting"); break;
    case "PostCompact": set("working"); break;
    case "SessionEnd": set("gone"); break;
    // default: heartbeat only (lastEventAt already bumped)
  }
  return s;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd daemon && bun test test/state-machine.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/state-machine.ts daemon/test/state-machine.test.ts
git commit -m "feat(daemon): pure hook state machine"
```

---

## Task 6: Derivation (headline, needsAttention, ProjectView builder)

**Files:**
- Create: `daemon/src/derive.ts`
- Test: `daemon/test/derive.test.ts`

**Interfaces:**
- Consumes: `Session`, `Project`, `ProjectView`, `ClaudeStatus` from `types.ts`.
- Produces: `headline(statuses: ClaudeStatus[]): ClaudeStatus`; `isNeedsAttention(h: ClaudeStatus): boolean`; `buildProjectViews(projects: Project[], sessions: Session[]): ProjectView[]`.

- [ ] **Step 1: Write the failing test `daemon/test/derive.test.ts`**

```ts
import { test, expect } from "bun:test";
import { headline, isNeedsAttention, buildProjectViews } from "../src/derive";
import type { Project, Session } from "../src/types";

const proj = (id: string): Project => ({
  id, name: id, path: `/dev/${id}`, devCommand: "pnpm dev", port: null, url: null, enabled: true,
});
const sess = (id: string, projectId: string | null, status: Session["status"]): Session => ({
  sessionId: id, cwd: "/dev/web", projectId, status, detail: null, pid: 1, subagents: 0,
  model: null, tokens: null, contextPct: null, transcriptPath: null, lastEventAt: 0, lastEvent: "x",
});

test("headline picks highest priority", () => {
  expect(headline(["idle", "working", "error"])).toBe("error");
  expect(headline(["working", "blocked_permission"])).toBe("blocked_permission");
  expect(headline(["idle"])).toBe("idle");
  expect(headline([])).toBe("gone");
});

test("needsAttention only for blocked/error", () => {
  expect(isNeedsAttention("blocked_permission")).toBe(true);
  expect(isNeedsAttention("error")).toBe(true);
  expect(isNeedsAttention("blocked_input")).toBe(true);
  expect(isNeedsAttention("working")).toBe(false);
  expect(isNeedsAttention("idle")).toBe(false);
});

test("buildProjectViews groups sessions per project and sets headline", () => {
  const views = buildProjectViews(
    [proj("web"), proj("api")],
    [sess("s1", "web", "working"), sess("s2", "web", "blocked_permission"), sess("s3", "api", "idle")],
  );
  const web = views.find((v) => v.project.id === "web")!;
  expect(web.claude.count).toBe(2);
  expect(web.claude.headline).toBe("blocked_permission");
  expect(web.claude.needsAttention).toBe(true);
  const api = views.find((v) => v.project.id === "api")!;
  expect(api.claude.headline).toBe("idle");
  expect(api.claude.needsAttention).toBe(false);
});

test("project with no sessions has count 0 and headline gone", () => {
  const views = buildProjectViews([proj("web")], []);
  expect(views[0].claude.count).toBe(0);
  expect(views[0].claude.headline).toBe("gone");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd daemon && bun test test/derive.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Create `daemon/src/derive.ts`**

```ts
import type { Project, Session, ProjectView, ClaudeStatus } from "./types";

const PRIORITY: ClaudeStatus[] = [
  "blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone",
];

export function headline(statuses: ClaudeStatus[]): ClaudeStatus {
  for (const s of PRIORITY) if (statuses.includes(s)) return s;
  return "gone";
}

export function isNeedsAttention(h: ClaudeStatus): boolean {
  return h === "blocked_permission" || h === "blocked_input" || h === "error";
}

export function buildProjectViews(projects: Project[], sessions: Session[]): ProjectView[] {
  return projects.map((project) => {
    const mine = sessions.filter((s) => s.projectId === project.id && s.status !== "gone");
    const h = headline(mine.map((s) => s.status));
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
      dev: { running: false, port: project.port, pid: null, managed: false }, // Phase 2 fills this
      browser: { tabOpen: false, ref: null },                                  // Phase 2 fills this
    };
  });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd daemon && bun test test/derive.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/derive.ts daemon/test/derive.test.ts
git commit -m "feat(daemon): headline priority + ProjectView derivation"
```

---

## Task 7: Session store (in-memory map + sessions.json mirror)

**Files:**
- Create: `daemon/src/sessions.ts`
- Test: `daemon/test/sessions.test.ts`

**Interfaces:**
- Consumes: `Session` from `types.ts`, `newSession`/`transition` from `state-machine.ts`, `resolveProjectId` from `resolve.ts`, `Registry` from `registry.ts`.
- Produces: `class SessionStore` with `constructor(filePath: string)`, `async load()`, `all(): Session[]`, `get(id): Session | undefined`, `upsertFromHook(payload, projects, now): Session`, `removeGone(now, graceMs): void`, `private mirror()`.

- [ ] **Step 1: Write the failing test `daemon/test/sessions.test.ts`**

```ts
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionStore } from "../src/sessions";
import type { Project, HookPayload } from "../src/types";

const projects: Project[] = [
  { id: "web", name: "web", path: "/dev/web", devCommand: "pnpm dev", port: null, url: null, enabled: true },
];
const ev = (name: string, extra: Partial<HookPayload> = {}): HookPayload =>
  ({ hook_event_name: name, session_id: "s1", cwd: "/dev/web/sub", ...extra });

let file: string;
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), "projflow-")), "sessions.json"); });

test("first hook creates session and resolves project by longest prefix", () => {
  const store = new SessionStore(file);
  const s = store.upsertFromHook(ev("SessionStart", { pid: 7 }), projects, 100);
  expect(s.projectId).toBe("web");
  expect(s.status).toBe("idle");
  expect(store.all().length).toBe(1);
});

test("subsequent hooks update the same session", () => {
  const store = new SessionStore(file);
  store.upsertFromHook(ev("SessionStart"), projects, 1);
  const s = store.upsertFromHook(ev("PreToolUse", { tool_name: "Edit" }), projects, 2);
  expect(s.status).toBe("working");
  expect(s.detail).toBe("Edit");
  expect(store.all().length).toBe(1);
});

test("removeGone drops sessions ended past the grace window", () => {
  const store = new SessionStore(file);
  store.upsertFromHook(ev("SessionEnd"), projects, 1000);
  store.removeGone(1000 + 5000, 10000);   // within grace -> kept
  expect(store.all().length).toBe(1);
  store.removeGone(1000 + 11000, 10000);  // past grace -> removed
  expect(store.all().length).toBe(0);
});

test("state survives reload from disk", async () => {
  const store = new SessionStore(file);
  store.upsertFromHook(ev("SessionStart", { pid: 9 }), projects, 1);
  const store2 = new SessionStore(file);
  await store2.load();
  expect(store2.get("s1")?.pid).toBe(9);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd daemon && bun test test/sessions.test.ts`
Expected: FAIL — `SessionStore` not defined.

- [ ] **Step 3: Create `daemon/src/sessions.ts`**

```ts
import { mkdirSync } from "fs";
import { dirname } from "path";
import type { Session, Project, HookPayload } from "./types";
import { newSession, transition } from "./state-machine";
import { resolveProjectId } from "./resolve";

export class SessionStore {
  private sessions = new Map<string, Session>();
  private goneAt = new Map<string, number>();
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    const f = Bun.file(this.filePath);
    if (await f.exists()) {
      const arr = (await f.json()) as Session[];
      this.sessions = new Map(arr.map((s) => [s.sessionId, s]));
    }
  }

  all(): Session[] { return [...this.sessions.values()]; }
  get(id: string): Session | undefined { return this.sessions.get(id); }

  upsertFromHook(payload: HookPayload, projects: Project[], now: number): Session {
    const id = payload.session_id;
    const existing = this.sessions.get(id) ?? newSession(id, payload.cwd, now);
    const next = transition(existing, payload, now);
    if (!next.projectId) next.projectId = resolveProjectId(payload.cwd, projects);
    this.sessions.set(id, next);
    if (next.status === "gone") this.goneAt.set(id, now); else this.goneAt.delete(id);
    this.mirror();
    return next;
  }

  removeGone(now: number, graceMs: number): void {
    for (const [id, at] of this.goneAt) {
      if (now - at >= graceMs) { this.sessions.delete(id); this.goneAt.delete(id); }
    }
    this.mirror();
  }

  private mirror(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      Bun.write(this.filePath, JSON.stringify(this.all(), null, 2));
    } catch { /* mirror is best-effort; never block a hook */ }
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd daemon && bun test test/sessions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/sessions.ts daemon/test/sessions.test.ts
git commit -m "feat(daemon): session store with persistence + gone grace"
```

---

## Task 8: Hook handler + wire `POST /hook` and `GET /state`

**Files:**
- Modify: `daemon/src/index.ts`
- Create: `daemon/src/hooks.ts`
- Test: `daemon/test/hooks.test.ts`, extend `daemon/test/server.test.ts`

**Interfaces:**
- Consumes: `Registry`, `SessionStore`, `buildProjectViews`, `HookPayload`.
- Produces: `handleHook(payload, registry, store, now): void`; an app exposing `POST /hook` (returns `{ ok: true }` instantly) and `GET /state` (returns `ProjectView[]`). A module-level singleton `registry` + `store` created in `index.ts` (override-able for tests via exported `__setStores`).

- [ ] **Step 1: Write the failing test `daemon/test/hooks.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd daemon && bun test test/hooks.test.ts`
Expected: FAIL — `handleHook` not defined.

- [ ] **Step 3: Create `daemon/src/hooks.ts`**

```ts
import type { HookPayload } from "./types";
import type { Registry } from "./registry";
import type { SessionStore } from "./sessions";

/** Apply one hook to state. Cheap + synchronous so POST /hook can return instantly. */
export function handleHook(payload: HookPayload, registry: Registry, store: SessionStore, now: number): void {
  if (!payload?.session_id || !payload?.hook_event_name) return;
  store.upsertFromHook(payload, registry.list(), now);
}
```

- [ ] **Step 4: Run the hooks test, verify it passes**

Run: `cd daemon && bun test test/hooks.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `daemon/test/server.test.ts` with an integration test**

```ts
import { test, expect } from "bun:test";
import { app, __setStores } from "../src/index";
import { Registry } from "../src/registry";
import { SessionStore } from "../src/sessions";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmp = () => join(mkdtempSync(join(tmpdir(), "projflow-")), "x.json");

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
```

- [ ] **Step 6: Update `daemon/src/index.ts`**

```ts
import { Hono } from "hono";
import { config } from "./config";
import { Registry } from "./registry";
import { SessionStore } from "./sessions";
import { handleHook } from "./hooks";
import { buildProjectViews } from "./derive";

export const app = new Hono();

let registry = new Registry(config.projectsFile);
let store = new SessionStore(config.sessionsFile);

/** Test seam: swap in temp-backed stores. */
export function __setStores(r: Registry, s: SessionStore) { registry = r; store = s; }

app.get("/health", (c) => c.json({ ok: true }));

app.post("/hook", async (c) => {
  // Return instantly; never let hook work block the response or throw upstream.
  let payload: any = null;
  try { payload = await c.req.json(); } catch { /* ignore malformed */ }
  if (payload) { try { handleHook(payload, registry, store, Date.now()); } catch { /* swallow */ } }
  return c.json({ ok: true });
});

app.get("/state", (c) => c.json(buildProjectViews(registry.list(), store.all())));

if (import.meta.main) {
  await registry.load();
  await store.load();
  Bun.serve({ port: config.port, hostname: "127.0.0.1", fetch: app.fetch });
  console.log(`projd listening on http://127.0.0.1:${config.port}`);
}
```

- [ ] **Step 7: Run all tests, verify they pass**

Run: `cd daemon && bun test`
Expected: PASS across all files (health, integration, hooks, units).

- [ ] **Step 8: Commit**

```bash
git add daemon/src/hooks.ts daemon/src/index.ts daemon/test/hooks.test.ts daemon/test/server.test.ts
git commit -m "feat(daemon): POST /hook + GET /state wired end-to-end"
```

---

## Task 9: Watchdog (pid liveness + heartbeat timeout)

**Files:**
- Create: `daemon/src/watchdog.ts`
- Modify: `daemon/src/index.ts` (start watchdog on boot)
- Test: `daemon/test/watchdog.test.ts`

**Interfaces:**
- Consumes: `SessionStore`.
- Produces: `sweep(store, now, opts): void` where `opts = { pidAlive(pid): boolean; staleMs: number; goneGraceMs: number }`. Marks dead-pid sessions `gone` (or `error` if they died mid-`working`), then runs `store.removeGone`. Also `startWatchdog(store, intervalMs): Timer` (thin wrapper calling `sweep` with real `process.kill(pid, 0)` liveness).

- [ ] **Step 1: Write the failing test `daemon/test/watchdog.test.ts`**

```ts
import { test, expect } from "bun:test";
import { sweep } from "../src/watchdog";
import { SessionStore } from "../src/sessions";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Project } from "../src/types";

const tmp = () => join(mkdtempSync(join(tmpdir(), "projflow-")), "x.json");
const projects: Project[] = [{ id: "web", name: "web", path: "/dev/web", devCommand: "pnpm dev", port: null, url: null, enabled: true }];
const opts = (alive: boolean) => ({ pidAlive: () => alive, staleMs: 90_000, goneGraceMs: 10_000 });

test("working session with dead pid -> error", () => {
  const store = new SessionStore(tmp());
  store.upsertFromHook({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: "/dev/web", pid: 1 } as any, projects, 1);
  // ensure pid is set
  store.upsertFromHook({ hook_event_name: "SessionStart", session_id: "s1", cwd: "/dev/web", pid: 1234 } as any, projects, 2);
  store.upsertFromHook({ hook_event_name: "PreToolUse", session_id: "s1", cwd: "/dev/web", tool_name: "Bash" } as any, projects, 3);
  sweep(store, 4, opts(false));
  expect(store.get("s1")?.status).toBe("error");
});

test("idle session with dead pid -> gone", () => {
  const store = new SessionStore(tmp());
  store.upsertFromHook({ hook_event_name: "SessionStart", session_id: "s2", cwd: "/dev/web", pid: 1234 } as any, projects, 1);
  sweep(store, 2, opts(false));
  expect(store.get("s2")?.status).toBe("gone");
});

test("working session with live pid but stale heartbeat stays working", () => {
  const store = new SessionStore(tmp());
  store.upsertFromHook({ hook_event_name: "SessionStart", session_id: "s3", cwd: "/dev/web", pid: 1234 } as any, projects, 1);
  store.upsertFromHook({ hook_event_name: "PreToolUse", session_id: "s3", cwd: "/dev/web", tool_name: "Bash" } as any, projects, 2);
  sweep(store, 2 + 200_000, opts(true)); // very stale but alive
  expect(store.get("s3")?.status).toBe("working");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd daemon && bun test test/watchdog.test.ts`
Expected: FAIL — `sweep` not defined.

- [ ] **Step 3: Create `daemon/src/watchdog.ts`**

```ts
import type { SessionStore } from "./sessions";

export interface SweepOpts {
  pidAlive: (pid: number) => boolean;
  staleMs: number;
  goneGraceMs: number;
}

/** One watchdog pass. Mutates session statuses via the store's hook path is avoided;
 *  instead we read sessions and re-write the affected ones through a minimal mark. */
export function sweep(store: SessionStore, now: number, opts: SweepOpts): void {
  for (const s of store.all()) {
    if (s.status === "gone") continue;
    const dead = s.pid != null && !opts.pidAlive(s.pid);
    if (dead) {
      store.markStatus(s.sessionId, s.status === "working" ? "error" : "gone", now);
    }
    // live pid + stale heartbeat while working => leave as working (long tool runs are normal)
  }
  store.removeGone(now, opts.goneGraceMs);
}

export function realPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function startWatchdog(store: SessionStore, intervalMs = 20_000) {
  return setInterval(
    () => sweep(store, Date.now(), { pidAlive: realPidAlive, staleMs: 90_000, goneGraceMs: 10_000 }),
    intervalMs,
  );
}
```

- [ ] **Step 4: Add `markStatus` to `SessionStore`** (in `daemon/src/sessions.ts`, inside the class)

```ts
  markStatus(id: string, status: import("./types").ClaudeStatus, now: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const next = { ...s, status, lastEventAt: now, lastEvent: "watchdog" };
    this.sessions.set(id, next);
    if (status === "gone") this.goneAt.set(id, now);
    this.mirror();
  }
```

- [ ] **Step 5: Run the watchdog test, verify it passes**

Run: `cd daemon && bun test test/watchdog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Start the watchdog on boot** — in `daemon/src/index.ts`, inside the `if (import.meta.main)` block, after `store.load()`:

```ts
  const { startWatchdog } = await import("./watchdog");
  startWatchdog(store);
```

- [ ] **Step 7: Run all tests**

Run: `cd daemon && bun test`
Expected: PASS across all files.

- [ ] **Step 8: Commit**

```bash
git add daemon/src/watchdog.ts daemon/src/sessions.ts daemon/src/index.ts daemon/test/watchdog.test.ts
git commit -m "feat(daemon): watchdog for pid liveness + heartbeat"
```

---

## Task 10: Hooks installer / uninstaller (merge into ~/.claude/settings.json)

**Files:**
- Create: `daemon/hooks/install.ts`, `daemon/hooks/uninstall.ts`
- Test: `daemon/test/install.test.ts`

**Interfaces:**
- Produces: `mergeHooks(existing: any, url: string): any` (pure — returns new settings object with projflow hooks merged, existing hooks preserved); `stripHooks(existing: any): any` (pure — removes only `projflow:`-tagged entries). The CLI entrypoints read/write `~/.claude/settings.json` using these.

- [ ] **Step 1: Write the failing test `daemon/test/install.test.ts`**

```ts
import { test, expect } from "bun:test";
import { mergeHooks, stripHooks, HOOK_EVENTS } from "../hooks/install";

test("merge adds all events as projflow-tagged http hooks", () => {
  const out = mergeHooks({}, "http://127.0.0.1:7777/hook");
  for (const ev of HOOK_EVENTS) {
    const entry = out.hooks[ev][0];
    expect(entry.description).toStartWith("projflow:");
    expect(entry.hooks[0]).toMatchObject({ type: "http", url: "http://127.0.0.1:7777/hook" });
  }
});

test("merge preserves existing non-projflow hooks", () => {
  const existing = { hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo hi" }] }] } };
  const out = mergeHooks(existing, "http://127.0.0.1:7777/hook");
  const stopEntries = out.hooks.Stop;
  expect(stopEntries.some((e: any) => e.hooks[0].type === "command")).toBe(true);   // kept
  expect(stopEntries.some((e: any) => e.description?.startsWith("projflow:"))).toBe(true); // added
});

test("merge is idempotent — re-running does not duplicate projflow entries", () => {
  const once = mergeHooks({}, "http://127.0.0.1:7777/hook");
  const twice = mergeHooks(once, "http://127.0.0.1:7777/hook");
  expect(twice.hooks.Stop.filter((e: any) => e.description?.startsWith("projflow:")).length).toBe(1);
});

test("strip removes only projflow entries, keeps the rest", () => {
  const existing = { hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo hi" }] }] } };
  const merged = mergeHooks(existing, "http://127.0.0.1:7777/hook");
  const stripped = stripHooks(merged);
  expect(stripped.hooks.Stop.length).toBe(1);
  expect(stripped.hooks.Stop[0].hooks[0].type).toBe("command");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd daemon && bun test test/install.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `daemon/hooks/install.ts`**

```ts
import { homedir } from "os";
import { join } from "path";

export const HOOK_EVENTS = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolBatch",
  "PermissionRequest", "Notification", "Stop", "StopFailure", "PostToolUseFailure",
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "SessionEnd",
] as const;

const TAG = "projflow: state hook";
const isProjflow = (entry: any) => typeof entry?.description === "string" && entry.description.startsWith("projflow:");

/** Pure: return new settings with projflow HTTP hooks merged in, existing hooks untouched. */
export function mergeHooks(existing: any, url: string): any {
  const out = structuredClone(existing ?? {});
  out.hooks ??= {};
  for (const ev of HOOK_EVENTS) {
    const list = (out.hooks[ev] ??= []);
    const filtered = list.filter((e: any) => !isProjflow(e)); // drop old projflow entries (idempotent)
    filtered.push({
      matcher: "",
      description: TAG,
      hooks: [{ type: "http", url, timeout: 5 }],
    });
    out.hooks[ev] = filtered;
  }
  return out;
}

/** Pure: remove only projflow-tagged entries; drop now-empty event arrays. */
export function stripHooks(existing: any): any {
  const out = structuredClone(existing ?? {});
  if (!out.hooks) return out;
  for (const ev of Object.keys(out.hooks)) {
    out.hooks[ev] = (out.hooks[ev] as any[]).filter((e) => !isProjflow(e));
    if (out.hooks[ev].length === 0) delete out.hooks[ev];
  }
  return out;
}

const settingsPath = join(homedir(), ".claude", "settings.json");

if (import.meta.main) {
  const url = `http://127.0.0.1:${process.env.PROJFLOW_PORT ?? 7777}/hook`;
  const f = Bun.file(settingsPath);
  const existing = (await f.exists()) ? await f.json() : {};
  await Bun.write(settingsPath, JSON.stringify(mergeHooks(existing, url), null, 2));
  console.log(`Installed projflow hooks into ${settingsPath} (${HOOK_EVENTS.length} events).`);
}
```

- [ ] **Step 4: Create `daemon/hooks/uninstall.ts`**

```ts
import { homedir } from "os";
import { join } from "path";
import { stripHooks } from "./install";

const settingsPath = join(homedir(), ".claude", "settings.json");

if (import.meta.main) {
  const f = Bun.file(settingsPath);
  if (!(await f.exists())) { console.log("No settings.json; nothing to remove."); process.exit(0); }
  const existing = await f.json();
  await Bun.write(settingsPath, JSON.stringify(stripHooks(existing), null, 2));
  console.log(`Removed projflow hooks from ${settingsPath}.`);
}
```

- [ ] **Step 5: Run the install test, verify it passes**

Run: `cd daemon && bun test test/install.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add daemon/hooks/install.ts daemon/hooks/uninstall.ts daemon/test/install.test.ts
git commit -m "feat(daemon): hooks installer/uninstaller (merge, idempotent, tagged)"
```

---

## Task 11: End-to-end manual smoke test (real Claude session)

**Files:** none (verification task). Confirms the Phase 1 deliverable: the signal works against a real session.

- [ ] **Step 1: Run the full unit/integration suite**

Run: `cd daemon && bun test`
Expected: ALL pass.

- [ ] **Step 2: Seed a registered project** — create `~/Library/Application Support/projflow/projects.json` (or your `PROJFLOW_DATA_DIR`) with one real project path you'll run Claude in:

```json
[{ "id": "demo", "name": "demo", "path": "/ABSOLUTE/PATH/YOU/WILL/USE", "devCommand": "pnpm dev", "port": null, "url": null, "enabled": true }]
```

- [ ] **Step 3: Start the daemon**

Run: `cd daemon && bun run start`
Expected: `projd listening on http://127.0.0.1:7777`.

- [ ] **Step 4: Install the real hooks** (separate terminal)

Run: `cd daemon && bun run install-hooks`
Expected: confirmation; `~/.claude/settings.json` now has 15 `projflow:` HTTP hook entries.

- [ ] **Step 5: Drive a real Claude turn** in the registered project (extension panel or integrated terminal, per Step 0.4). Submit a prompt that triggers a tool needing approval (so you hit a permission prompt).

- [ ] **Step 6: Observe state transitions**

Run (repeatedly): `curl -s localhost:7777/state | python3 -m json.tool`
Expected sequence for the `demo` project: `idle` → `working` → `blocked_permission` (`needsAttention: true`) → after approval `working` → `idle` on Stop.

- [ ] **Step 7: Confirm crash recovery** — stop the daemon (Ctrl-C), restart with `bun run start`, `curl localhost:7777/state`. Expected: prior sessions reload from `sessions.json`.

- [ ] **Step 8: Document the result** in `daemon/README.md` (brief): how to start, install hooks, the `/state` shape, and which hook-firing mode (Step 0.4) was confirmed. Commit:

```bash
git add daemon/README.md
git commit -m "docs(daemon): phase 1 run instructions + verified hook mode"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §2 architecture (Task 1, 8), §4 data models (Task 2), §5 state machine + Notification branching + watchdog (Tasks 5, 9), longest-prefix join (Task 3), headline/needsAttention/ProjectView (Task 6), registry (Task 4), session persistence (Task 7), `POST /hook`+`GET /state` instant-return (Task 8), hooks installer merge/tag/idempotent (Task 10), §3/§7 hook-firing verification (Step 0). Dev/browser fields in `ProjectView` are stubbed in Task 6 and filled in **Phase 2** (out of scope here, noted inline).
- **Out of scope for Phase 1 (later plans):** `lsof` detection, Chrome AppleScript, Electrobun tray/dropdown, actions (dev/browser/editor), transcript tokens/context%, SSE `/events`, registry HTTP CRUD endpoints (Phase 2 adds them with the settings UI).
- **Placeholder scan:** none — every code/test step is complete.
- **Type consistency:** `ProjectView`/`Session`/`Project` shapes match across `types.ts`, `derive.ts`, `sessions.ts`, `index.ts`; `markStatus` added to `SessionStore` in Task 9 and used by `sweep`; `HOOK_EVENTS` shared by installer + test.
```
