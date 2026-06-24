# projflow — Implementation Spec (Claude Code handoff)

> Working name: **projflow** · daemon: **projd** · hook/CLI prefix: `projflow:`
> Rename freely. macOS only (Apple Silicon/Intel), macOS 14+.

A macOS menu bar "mission control" for working on multiple projects in parallel. For each registered project, see at a glance: is a Claude Code session running and *does it need me* (busy vs waiting vs blocked vs error), is the dev server up and on which port, and is there a browser tab already pointing at it. One-click actions: jump to the tab (or start `pnpm dev` and open it), focus the editor.

The whole point is the **at-a-glance "which of my N projects needs me right now" signal**, so I stop hunting through windows.

---

## 1. Architecture

Two processes. Keep them separate — do not put logic in the menu bar UI.

```
        ┌───────────────────────────────┐
        │  Menu bar UI (thin client)    │  reads GET /state, renders dropdown,
        │  Tauri v2 / Electron / SwiftBar│  POSTs actions. Holds no state.
        └───────────────┬───────────────┘
                        │ HTTP (127.0.0.1) + optional SSE
        ┌───────────────▼───────────────┐
        │   projd  (Bun + Hono daemon)  │  the brain. Long-lived.
        │  • project registry           │
        │  • session state machine      │
        │  • owns dev-server children   │
        │  • port + Chrome pollers       │
        │  • transcript JSONL reader     │
        └───┬───────────┬───────────┬───┘
   hooks PUSH│    polls  │           │ actions
   ┌─────────▼──┐   ┌────▼────┐  ┌───▼──────────────┐
   │ Claude Code│   │ lsof    │  │ AppleScript →    │
   │ sessions   │   │ (ports) │  │ Chrome + editor  │
   │(HTTP hooks)│   └─────────┘  │ spawn pnpm dev   │
   └────────────┘                └──────────────────┘
```

**Join key for everything is the absolute project directory path (`cwd`).** Claude sessions, dev-server ports, and browser URLs all resolve back to a registered project via its path/port. Use **longest-prefix match** of a session's `cwd` against registered `project.path` so monorepo subdirectories resolve to the right project.

**Stack note:** the daemon is plain TypeScript on **Bun + Hono** (already in my stack). It is identical regardless of which UI shell is chosen, so build it first.

---

## 2. Open decisions (confirm before/while building)

1. **UI shell.** Recommended **Tauri v2** — native tray, ~tiny memory, good for an always-on widget; UI inside is React/TS. Alternatives: **Electron** (all-TS, familiar, but heavier for always-on) or **SwiftBar** (prototype only — limited interactivity). The daemon's HTTP API is the same for all three. Suggested path: prototype the readout in SwiftBar against `/state`, then build the real UI in Tauri.
2. **Dev servers: managed vs detect-only.** Recommended **managed** — `projd` spawns the dev command as a child it owns, so it knows the PID + port and can stop/restart. Also keep `lsof` polling on, to detect servers started manually in VSCode.
3. **Chrome control: AppleScript vs CDP.** Recommended **AppleScript** (zero setup, enumerate + focus tabs). Alternative **CDP** (`--remote-debugging-port=9222`) is more robust for focusing but requires launching Chrome with the flag.

---

## 3. Prerequisite to verify FIRST (blocking)

Confirm the **VSCode Claude extension fires `~/.claude/settings.json` hooks.** It runs Claude Code core so it should, but the extension's GUI may handle permission prompts internally rather than emitting `Notification:permission_prompt`.

Test: add a temporary `Stop` hook that `touch`es a file, run one turn in the extension, check the file appears. If hooks don't fire from the extension panel, the fallback is to run `claude` in VSCode's **integrated terminal**, which fires every hook reliably. Decide which mode the rest of the build targets based on this result.

---

## 4. Data models

### Project registry entry
Stored at `~/Library/Application Support/projflow/projects.json`.

```ts
interface Project {
  id: string;            // stable slug, e.g. "iris-web"
  name: string;          // display name
  path: string;          // absolute dir — the join key
  devCommand: string;    // e.g. "pnpm dev"
  port: number | null;   // expected dev port; null = auto-detect from output/lsof
  url: string | null;    // browser URL; default `http://localhost:${port}`
  enabled: boolean;
}
```

### Session state
In-memory map keyed by `sessionId`; mirrored to `sessions.json` for crash recovery.

```ts
type ClaudeStatus =
  | 'idle'               // alive, your turn, nothing running
  | 'working'            // generating or running tools
  | 'blocked_permission' // waiting on your approval — hard block
  | 'blocked_input'      // waiting for your prompt / MCP elicitation
  | 'error'              // turn/tool failed, or process crashed
  | 'compacting'         // context compaction in progress
  | 'gone';              // session ended / process died

interface Session {
  sessionId: string;
  cwd: string;
  projectId: string | null;   // resolved via longest-prefix match
  status: ClaudeStatus;
  detail: string | null;      // tool name, error subtype, or last-msg snippet
  pid: number | null;
  subagents: number;          // active subagent count
  model: string | null;       // from transcript
  tokens: { input: number; output: number; total: number } | null;
  contextPct: number | null;  // total / model context window
  transcriptPath: string | null;
  lastEventAt: number;        // heartbeat — epoch ms
  lastEvent: string;
}
```

### Dev server state
```ts
interface DevServer {
  projectId: string;
  pid: number | null;
  port: number | null;
  status: 'starting' | 'running' | 'stopped' | 'crashed';
  startedAt: number | null;
  logFile: string;            // ~/Library/Application Support/projflow/logs/{id}.log
  managed: boolean;           // true if projd spawned it
}
```

### Derived per-project view (what `GET /state` returns, what the UI renders)
```ts
interface ProjectView {
  project: Project;
  claude: {
    count: number;            // sessions in this project
    headline: ClaudeStatus;   // highest-priority status (see ordering below)
    needsAttention: boolean;  // headline in {blocked_permission, blocked_input, error}
    sessions: Pick<Session,'sessionId'|'status'|'detail'|'model'|'contextPct'>[];
  };
  dev: { running: boolean; port: number | null; pid: number | null; managed: boolean };
  browser: { tabOpen: boolean; ref: { windowIndex: number; tabIndex: number } | null };
}
```

**Status priority (for the headline badge when a project has multiple sessions):**
`blocked_permission` > `error` > `blocked_input` > `compacting` > `working` > `idle` > `gone`.

---

## 5. The state machine (core logic)

Register HTTP hooks for the events below. On each `POST /hook`, resolve the session by `session_id`, resolve the project by `cwd` (longest-prefix), apply the transition, bump `lastEventAt`.

| Hook event | Matcher | Transition |
|---|---|---|
| `SessionStart` | — | upsert session → `idle`; capture `pid`, `transcript_path` |
| `UserPromptSubmit` | — | → `working`, clear `detail` |
| `PreToolUse` | — | → `working`, `detail = tool_name` (heartbeat) |
| `PostToolUse` | — | stay `working` (heartbeat) |
| `PostToolBatch` | — | stay `working` (heartbeat) |
| `PermissionRequest` | — | → `blocked_permission` |
| `Notification` | — | branch on payload type (see below) |
| `Stop` | — | → `idle` (turn done, ready) |
| `StopFailure` | — | → `error`, `detail = error subtype` (e.g. `rate_limit`) |
| `PostToolUseFailure` | — | transient error flag on `detail`; next heartbeat clears |
| `SubagentStart` | — | `subagents++`; `detail = "working, N agents"` |
| `SubagentStop` | — | `subagents--` |
| `PreCompact` | — | → `compacting` |
| `PostCompact` | — | → `working` (or `idle` if turn already ended) |
| `SessionEnd` | — | → `gone`; remove after ~10s grace |

**`Notification` payload branching** (single hook, matcher `""`, inspect the notification type in the payload):
- `permission_prompt` → `blocked_permission`
- `idle_prompt` → `blocked_input`
- `elicitation_dialog` → `blocked_input`, `detail = "MCP input"`
- `auth_success` / others → ignore (or log)

**Heartbeat / crash detection (watchdog):**
- Poll each session's `pid` every ~20s (cmux uses 30s). If a `pid` is dead and we never saw `SessionEnd` → set `gone` (or `error` if it was mid-`working`).
- If `status === 'working'` but `lastEventAt` is older than ~90s and pid alive → keep `working` (long tool runs are normal); if pid dead → `error`.

> **MessageDisplay note:** there is a `MessageDisplay` hook that fires while assistant text streams — usable as a pure-generation heartbeat. It fires very frequently. **Skip it in v1**; the `PreToolUse`/`PostToolUse` heartbeat is enough for the working state. Add `MessageDisplay` (throttled daemon-side) only if pure-text turns with no tool calls feel unresponsive.

---

## 6. Transcript reader (tokens / context % / model / last message)

Phase 4 polish — mirrors how cmux shows token/context numbers, but via the transcript file instead of screen-scraping (we can't scrape VSCode's PTY).

- On `SessionStart`, capture `transcript_path` from the payload.
- Tail the JSONL: each assistant message line carries `usage` (input/output tokens) and `model`. Take the last assistant text as `detail` snippet; sum tokens; `contextPct = total / contextWindow(model)`.
- Keep a small `model → contextWindow` map (configurable; values change over time — don't hardcode permanently).
- Throttle: read on `Stop` and at most every few seconds while `working`.

---

## 7. Detection: dev servers & ports

Poller every ~3–5s:
```bash
# all listening TCP sockets with pid + port
lsof -nP -iTCP -sTCP:LISTEN -F pn
# for a given pid, its working directory
lsof -a -d cwd -p <pid> -F n
```
Map `cwd → project` (longest-prefix), set `dev.running` + `port`. For **managed** servers we already know pid+port (authoritative); use `lsof` as confirmation and to catch servers started manually in VSCode. No `sudo` needed for own processes.

---

## 8. Detection & control: Chrome tabs (AppleScript path)

**Enumerate** (poll on dropdown-open to keep idle cost low):
```applescript
tell application "Google Chrome"
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
  return out
end tell
```
Match URL/port → project; store `{windowIndex, tabIndex}` in `browser.ref`.

**Focus existing tab:**
```applescript
tell application "Google Chrome"
  set active tab index of window <wi> to <ti>
  set index of window <wi> to 1
  activate
end tell
```

**Open new tab** (no match): `tell application "Google Chrome" to open location "<url>"` then `activate`.

**macOS Automation permission:** the first AppleScript control triggers a TCC prompt. It attaches to the *host process*. Run `projd` **inside the menu bar app bundle** (or as a launch agent owned by it) so the permission attaches to the app, not to Terminal. Document granting it under System Settings → Privacy & Security → Automation.

**CDP alternative:** launch Chrome with `--remote-debugging-port=9222`, `GET http://localhost:9222/json` to list tabs, `Target.activateTarget` to focus. More robust focusing; requires the debug flag. Chrome-first either way (Arc/others have weaker AppleScript support).

---

## 9. Actions: dev server spawn

```ts
// spawn under a login shell so pnpm + node version managers (fnm/nvm/mise) resolve
spawn(process.env.SHELL ?? '/bin/zsh', ['-lc', project.devCommand], {
  cwd: project.path,
  detached: true,            // own process group so we can kill the tree
  stdio: ['ignore', logFd, logFd],
});
```
- **Port discovery:** parse the dev output for `localhost:PORT` (Vite/Next print it), confirm via `lsof` on the child after a short delay.
- **Stop:** kill the process *group* (negative PID): `SIGTERM`, then `SIGKILL` after a timeout.
- **Logs:** stream to `…/logs/{projectId}.log`; expose a "view logs" path in the UI.
- This is the **login-shell gotcha** — without `-lc`, `pnpm` often isn't on PATH.

---

## 10. Daemon HTTP API (Hono)

All on `127.0.0.1:<PORT>` (pick a fixed default, e.g. 7777; make configurable).

| Method · Route | Purpose |
|---|---|
| `POST /hook` | Receives Claude Code hook payloads. **Return 200 instantly**, do work async (hooks have short timeouts; HTTP-hook failures are non-blocking, so the daemon being down never breaks Claude Code). |
| `GET /state` | Returns `ProjectView[]`. UI polls ~1s, or use SSE below. |
| `GET /events` | Optional SSE stream pushing state diffs to the UI. |
| `GET/POST/PUT/DELETE /projects[/:id]` | Registry CRUD. |
| `POST /actions/dev/start` `{projectId}` | Spawn dev command (§9). |
| `POST /actions/dev/stop` `{projectId}` | Kill the managed dev process group. |
| `POST /actions/browser/open` `{projectId}` | Focus existing Chrome tab for the URL, else open a new one (§8). |
| `POST /actions/editor/focus` `{projectId}` | `code -r <path>` (reuse/focus the window), or `vscode://file/<path>`. |

---

## 11. Menu bar UI (thin client)

- Polls `GET /state` (1s) or subscribes to `/events`.
- **Menu bar icon = global signal:** badge/dot when *any* project `needsAttention` (blocked/error); subtle accent if any `working`; plain when all idle. This is the core UX.
- **Dropdown** lists registered projects, each row:
  - name + Claude status badge (color/icon per `ClaudeStatus`, count if multiple sessions, strong emphasis for blocked/error)
  - dev dot: green + `:port` if running, grey if stopped
  - browser dot: filled if a tab is open
- **Row actions:**
  - dev stopped → **Start dev** → `POST /actions/dev/start`
  - dev running → **Open** (browser focus/open) → `POST /actions/browser/open`; optional **Stop**
  - **Focus editor** → `POST /actions/editor/focus`
- Settings pane → registry CRUD (add project: pick folder, set devCommand/port/url).

---

## 12. Hooks installer

A script (`hooks/install.ts`) that **merges** projflow's HTTP hooks into `~/.claude/settings.json` without clobbering existing hooks. Tag each entry with a `description` starting `projflow:` so uninstall can filter them out cleanly (same pattern the cmux integrations use).

Each entry is an HTTP handler:
```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": [
        { "type": "http", "url": "http://127.0.0.1:7777/hook", "timeout": 5 }
      ]}
    ]
  }
}
```
Register: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolBatch`, `PermissionRequest`, `Notification`, `Stop`, `StopFailure`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `SessionEnd`. (Skip `MessageDisplay` in v1.)

User-level install applies to **all** projects automatically — no per-repo setup.

---

## 13. Suggested file layout

```
projflow/
  daemon/                 # Bun + Hono
    src/
      index.ts            # Hono app + start pollers/watchdog
      registry.ts         # projects.json CRUD
      sessions.ts         # session state + transitions
      hooks.ts            # POST /hook routing (§5)
      transcript.ts       # JSONL tailer (§6)
      detect-ports.ts     # lsof poller (§7)
      detect-chrome.ts    # AppleScript enumerate/focus (§8)
      actions.ts          # dev spawn/stop, browser, editor (§9)
      state.ts            # derive ProjectView[] (§4)
      watchdog.ts         # pid polling + heartbeat timeouts (§5)
    package.json
  ui/                     # Tauri v2 (or SwiftBar prototype script)
  hooks/
    install.ts            # merge hooks into ~/.claude/settings.json (§12)
    uninstall.ts
  README.md
```

---

## 14. Build phases

- **Phase 1 — prove the core signal.** Daemon + hooks installer + state machine + `GET /state` + a SwiftBar readout. No actions. Validates "which session needs me" end-to-end. *(Verify §3 first.)*
- **Phase 2 — detection + real UI.** lsof port detection + Chrome tab detection + Tauri tray with status badges and the global attention indicator.
- **Phase 3 — actions.** Start/stop dev, open/focus browser, focus editor.
- **Phase 4 — richness.** Transcript tokens/context %/model, multi-session-per-project aggregation, logs viewer, polish.

---

## 15. Gotchas (carry into implementation)

- **VSCode extension hooks** — verify §3 before anything else.
- **Single notification path** — we only have hooks (no OSC/screen scraping in VSCode). That's simpler and avoids cmux's documented dual-path race conditions. Don't add a second path.
- **Automation TCC** — run `projd` under the app bundle so the Chrome-control permission attaches to the app (§8).
- **Login-shell PATH** — spawn dev via `$SHELL -lc` or `pnpm` won't resolve (§9).
- **HTTP hook timeouts** — `/hook` must return instantly; do work async. Daemon down ≠ Claude Code broken (HTTP-hook failures are non-blocking).
- **Monorepos** — resolve `cwd → project` by longest-prefix match.
- **Model context windows** — keep the `model → window` map configurable; values change.
