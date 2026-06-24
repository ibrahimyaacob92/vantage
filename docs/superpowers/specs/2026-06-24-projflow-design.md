# projflow — Design Spec

> Date: 2026-06-24 · Working name: **projflow** · daemon: **projd** · hook/CLI prefix: `projflow:`
> macOS only (Apple Silicon/Intel), macOS 14+.
> This document is the authoritative design. It builds on `product-spect.md` and records the
> decisions made during brainstorming. Where this doc and `product-spect.md` differ, **this doc wins**.

## 0. What we're building (one paragraph)

A macOS **menu-bar "mission control"** for working on multiple coding projects in parallel. For each
registered project it answers, at a glance: *is a Claude Code session running and does it need me*
(idle / working / blocked / error), *is the dev server up and on which port*, and *is there a Chrome
tab already pointing at it*. One-click actions: jump to the tab (or start `pnpm dev` and open it),
focus the editor. The whole point is the **at-a-glance "which of my N projects needs me right now"
signal** so the user stops hunting through windows.

## 1. Decisions locked during brainstorming

| Topic | Decision | Notes |
|---|---|---|
| Scope | **Full build, all 4 phases** | Sequenced in §8. |
| UI shell | **Electrobun** (Bun + TypeScript, native macOS tray) | Replaces the spec's Tauri/Electron/SwiftBar. One Bun runtime end-to-end. |
| Daemon | **Bun + Hono** (`projd`) | Unchanged from `product-spect.md`. |
| Dev servers | **Managed** (projd owns the `pnpm dev` child) + `lsof` polling as backup | Per spec §2.2 recommendation. |
| Chrome control | **AppleScript** | Zero setup; per spec §2.3 recommendation. |
| Menu-bar display | **Inline project row (format A+B), all projects shown** | See §3. This is the main change from the original "single icon" idea. |
| Hook verification | **Build step 0 (blocking)** | See §7. |

## 2. Architecture (two processes)

```
  ┌─────────────────────────────────────────────┐
  │  Menu bar UI  (Electrobun, thin client)      │  renders inline row from GET /state,
  │  • native tray inline row  • dropdown        │  opens dropdown, POSTs actions.
  │  • settings webview window                   │  HOLDS NO STATE.
  └───────────────────────┬─────────────────────┘
                          │ HTTP (127.0.0.1:7777) + optional SSE
  ┌───────────────────────▼─────────────────────┐
  │   projd  (Bun + Hono daemon) — the brain     │  long-lived, holds ALL state
  │  • project registry   • session state machine│
  │  • owns dev-server children                  │
  │  • port poller (lsof)  • Chrome poller (AS)  │
  │  • transcript JSONL reader  • watchdog       │
  └──┬──────────────┬───────────────┬───────────┘
 hooks PUSH     lsof poll      AppleScript / spawn
 (Claude Code)  (dev ports)    (Chrome + editor + pnpm dev)
```

**Join key for everything is the absolute project directory path (`cwd`).** Claude sessions,
dev-server ports, and browser URLs all resolve back to a registered project. Resolve a session's
`cwd` against registered `project.path` by **longest-prefix match** so monorepo subdirectories map
to the right project.

**Discipline: no logic in the UI.** The daemon is identical regardless of the shell on top. Build the
daemon first; it is independently runnable and testable.

If the daemon is down the UI shows "disconnected" — Claude Code itself is never affected, because
HTTP-hook failures are non-blocking.

## 3. Menu-bar UI — the inline project row (primary UX)

The menu bar shows a **live row of project indicators**, always visible (like the *Stats* app showing
CPU / RAM / battery inline). Format is **A+B**: a compact totals summary, then every project named.

```
 ●2 ●1 ●3 ┃ ●iris ●docs ●pay ●mktg ●api ●blog
 └ B: totals ┘ └ A: every project, dot + short name, urgency-sorted ────┘
   red yel blue
```

- **B — totals summary (left):** one colored dot + count per state group, e.g. `●2` red (need you),
  `●1` yellow (working), `●3` blue (idle). Lets the user read "2 things need me" without reading names.
- **`┃` separator** between summary and list.
- **A — per-project list (right):** every enabled project as `● <shortName>`, color = its headline
  status. **Urgency-sorted** (red → yellow → blue) so blocked/error float left where the eye lands.
- **All projects always shown** (user accepted the width). Rendered as **small condensed attributed
  text + small dots** so 6+ projects still fit.
- **Click anywhere** on the row → opens the dropdown (§3.1).

Color → status mapping (the headline status per project):

| Color | Status | Meaning |
|---|---|---|
| 🔴 red | `blocked_permission` / `error` / `blocked_input` | **needsAttention** — go look |
| 🟣 purple | `compacting` | busy compacting, don't interrupt |
| 🟡 yellow | `working` | generating / running tools |
| 🔵 blue | `idle` | alive, your turn |
| ⚪ grey | `gone` | session ended |

### 3.1 Dropdown (full detail + actions)

One row per enabled project:

```
🔴 iris-web          ● :3000   ◉ tab
   ⛔ waiting for permission · "Bash(rm…)"
   [ Open ]  [ Stop dev ]  [ Focus editor ]
```

- Line 1: status dot + name · dev dot (`● :PORT` running / `○ stopped`) · browser dot (`◉` tab open / `○`).
- Line 2: detail — *why* it needs you (tool name / error subtype) or what it's doing; session count if >1.
- Actions adapt to state: dev stopped → **Start dev**; dev running → **Open** (focus existing Chrome
  tab, else open one) + **Stop dev**; always **Focus editor**.
- Footer: **Settings…** and a daemon-connection indicator.

### 3.2 Settings window (Electrobun webview)

Registry CRUD: add project (pick folder, set `devCommand` / `port` / `url`), toggle `enabled`, delete,
set daemon port, reinstall hooks.

### 3.3 Electrobun rendering approach

The inline row is rendered as **one menu-bar status item whose title is a composed attributed string**
(all projects in one label), refreshed ~1s from `GET /state`. This gives the Stats-like inline look
reliably. Independently-clickable per-project segments in the bar (separate native status items) are
**out of scope** for v1; revisit only if per-project bar click targets are wanted later.

**TCC / Automation note:** the first AppleScript Chrome control triggers a macOS Automation permission
prompt that attaches to the host process. For dev we run `projd` standalone (prompt attaches to the
dev host). In Phase 4 we bundle `projd` inside the Electrobun app so the permission attaches to the app.

## 4. Data models

(Per `product-spect.md` §4 — unchanged. Summarized here; that file is the field-level reference.)

- **Project** — `{ id, name, path (join key), devCommand, port|null, url|null, enabled }`. Stored at
  `~/Library/Application Support/projflow/projects.json`.
- **Session** — keyed by `sessionId`: `{ cwd, projectId|null, status, detail, pid, subagents, model,
  tokens, contextPct, transcriptPath, lastEventAt, lastEvent }`. Mirrored to `sessions.json`.
- **ClaudeStatus** — `idle | working | blocked_permission | blocked_input | error | compacting | gone`.
- **DevServer** — `{ projectId, pid, port, status, startedAt, logFile, managed }`.
- **ProjectView** (what `GET /state` returns / UI renders) — `{ project, claude: { count, headline,
  needsAttention, sessions[] }, dev: { running, port, pid, managed }, browser: { tabOpen, ref } }`.

**Headline priority** (multi-session project): `blocked_permission > error > blocked_input >
compacting > working > idle > gone`. `needsAttention = headline ∈ {blocked_permission, blocked_input,
error}`.

## 5. State machine (core logic — must be exact)

On each `POST /hook`: resolve session by `session_id`, resolve project by `cwd` (longest-prefix),
apply one transition, bump `lastEventAt`. **Return 200 instantly; do work async.**

| Hook | Transition |
|---|---|
| `SessionStart` | upsert → `idle`; capture `pid`, `transcript_path` |
| `UserPromptSubmit` | → `working`, clear `detail` |
| `PreToolUse` | → `working`, `detail = tool_name` (heartbeat) |
| `PostToolUse` / `PostToolBatch` | stay `working` (heartbeat) |
| `PermissionRequest` | → `blocked_permission` |
| `Notification` | branch on payload type (below) |
| `Stop` | → `idle` |
| `StopFailure` | → `error`, `detail = subtype` (e.g. `rate_limit`) |
| `PostToolUseFailure` | transient error flag on `detail`; next heartbeat clears |
| `SubagentStart` / `SubagentStop` | `subagents++` / `--`; detail `"working, N agents"` |
| `PreCompact` / `PostCompact` | → `compacting` / → `working` (or `idle` if turn ended) |
| `SessionEnd` | → `gone`; remove after ~10s grace |

**`Notification` branching:** `permission_prompt` → `blocked_permission`; `idle_prompt` →
`blocked_input`; `elicitation_dialog` → `blocked_input` (`detail = "MCP input"`); others → ignore.

**Watchdog (~20s):** poll each session `pid`; dead pid without `SessionEnd` → `gone` (or `error` if it
died mid-`working`). `working` with `lastEventAt` > ~90s but pid alive → stay `working` (long tool runs);
pid dead → `error`.

Skip `MessageDisplay` in v1.

The transition function is **pure** (event + state → state) and isolated from HTTP/Electrobun — it is
the most testable unit and gets real unit tests (TDD).

## 6. Detection, actions, transcript

- **Ports (§7 of product-spect):** poller every ~3–5s. `lsof -nP -iTCP -sTCP:LISTEN -F pn`, then
  `lsof -a -d cwd -p <pid> -F n` to map pid→cwd→project (longest-prefix). For managed servers pid+port
  are authoritative; `lsof` confirms and catches servers started manually in VSCode.
- **Chrome (§8):** AppleScript enumerate tabs on dropdown-open (low idle cost), match URL/port→project,
  store `{windowIndex, tabIndex}`. Focus existing tab or `open location` a new one.
- **Dev spawn (§9):** `spawn($SHELL ?? '/bin/zsh', ['-lc', devCommand], { cwd, detached:true, stdio:
  ['ignore', logFd, logFd] })`. Parse output for `localhost:PORT`, confirm via `lsof`. Stop = kill the
  process **group** (negative pid): SIGTERM then SIGKILL. Logs → `…/logs/{id}.log`.
  **Login-shell gotcha:** without `-lc`, `pnpm` often isn't on PATH.
- **Editor focus:** `code -r <path>` (reuse/focus window) or `vscode://file/<path>`.
- **Transcript (Phase 4, §6):** capture `transcript_path` on `SessionStart`, tail JSONL, read `usage`
  + `model` from assistant lines, last assistant text as `detail` snippet, `contextPct = total /
  contextWindow(model)`. Keep `model → contextWindow` map **configurable**. Throttle: on `Stop` and at
  most every few seconds while `working`.

## 7. Build step 0 — verify hooks fire from the VSCode extension (BLOCKING)

The entire input path depends on Claude Code hooks reaching `POST /hook`. The VSCode Claude extension
runs Claude Code core so it *should* fire `~/.claude/settings.json` hooks, but its GUI may handle some
prompts internally.

**Test:** add a temporary `Stop` (and `UserPromptSubmit`) hook that appends to `/tmp/projflow-hook-test.log`,
run one turn in the extension, confirm the log appears. **This requires editing `~/.claude/settings.json`,
which needs the user's approval** (auto-mode blocks self-modification of settings).

- **If hooks fire from the extension panel** → proceed; user-level install covers all projects with no
  per-repo setup.
- **If they do NOT fire** → fallback: run `claude` in VSCode's **integrated terminal**, which fires every
  hook reliably. The rest of the build targets whichever mode this test confirms.

## 8. HTTP API (Hono, `127.0.0.1:7777`, configurable)

| Route | Purpose |
|---|---|
| `POST /hook` | Receive hook payloads. **Return 200 instantly**, work async. |
| `GET /state` | `ProjectView[]`. UI polls ~1s (or SSE). |
| `GET /events` | Optional SSE diff stream. |
| `GET/POST/PUT/DELETE /projects[/:id]` | Registry CRUD. |
| `POST /actions/dev/start` `{projectId}` | Spawn dev command. |
| `POST /actions/dev/stop` `{projectId}` | Kill managed dev process group. |
| `POST /actions/browser/open` `{projectId}` | Focus/open Chrome tab. |
| `POST /actions/editor/focus` `{projectId}` | `code -r <path>`. |

## 9. File layout

```
projflow/
  daemon/ (Bun + Hono)
    src/ index.ts registry.ts sessions.ts hooks.ts transcript.ts
         detect-ports.ts detect-chrome.ts actions.ts state.ts watchdog.ts
    package.json
  ui/ (Electrobun)         tray inline row + dropdown + settings webview
  hooks/ install.ts uninstall.ts   # merge projflow HTTP hooks into ~/.claude/settings.json
  README.md
```

Hooks installer **merges** into `~/.claude/settings.json` without clobbering, tagging each entry with a
`description` starting `projflow:` for clean uninstall. Registers: `SessionStart, UserPromptSubmit,
PreToolUse, PostToolUse, PostToolBatch, PermissionRequest, Notification, Stop, StopFailure,
PostToolUseFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, SessionEnd`. Each entry is an
HTTP handler pointing at `http://127.0.0.1:7777/hook` (timeout 5). Skip `MessageDisplay` in v1.

## 10. Build phases

0. **Verify §7 hooks fire** (user approves temp settings change).
1. **Phase 1 — prove the signal.** Daemon skeleton + registry + state machine + `POST /hook` +
   `GET /state` + hooks installer. Validate "which session needs me" by driving real Claude turns.
2. **Phase 2 — detection + real UI.** `lsof` port detection + Chrome tab detection + the Electrobun
   tray inline row (A+B) + dropdown with badges + the global signal.
3. **Phase 3 — actions.** Dev start/stop, browser open/focus, editor focus.
4. **Phase 4 — richness.** Transcript tokens/context%/model, multi-session aggregation, logs viewer,
   bundle `projd` into the app for TCC, polish.

## 11. Testing strategy

- **Unit (TDD):** state-machine transition function; longest-prefix `cwd → project` resolver; headline-
  priority + `needsAttention` derivation; `model → contextWindow` lookup.
- **Integration:** POST recorded/fake hook payloads to `/hook`, assert resulting `GET /state`.
- **Manual:** Electrobun tray/dropdown rendering and OS-permission flows (AppleScript, TCC).

## 12. Gotchas (carry into implementation)

- Verify §7 before any app code.
- Single notification path (hooks only) — do **not** add a second path; avoids race conditions.
- Run `projd` under the app bundle (Phase 4) so Chrome-control TCC attaches to the app.
- Spawn dev via `$SHELL -lc` or `pnpm` won't resolve.
- `/hook` must return instantly; daemon down ≠ Claude Code broken.
- Monorepos → longest-prefix `cwd → project`.
- Keep `model → contextWindow` map configurable; values change.
