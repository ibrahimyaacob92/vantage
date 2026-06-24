# Vantage

**A macOS menu-bar mission control for working on many projects in parallel with [Claude Code](https://claude.com/claude-code).**

At a glance, Vantage answers the question *"which of my projects needs me right now?"* — without hunting through windows. For each project you register, the menu bar shows a compact tile (a 4‑letter code + a colored dot per active Claude session), and a click opens a popover with full status and one‑click actions: jump to the dev server's browser tab, or open the project in your editor.

> Status: early, working, and **open source** — contributions welcome via pull request. macOS only.

---

## What it looks like

- **Menu bar:** one small tile per visible project — `COLL ●●` — where the dots are colored by what each Claude session is doing.
- **Popover (click the tile):** each project's live status, its open `localhost` browser tabs (focus/close/open), an "open editor" button, and a color legend.
- **Settings:** add / edit / remove projects, set each project's 4‑letter code, toggle which projects appear in the menu bar, and enable "open at login".

### What the dots mean

| Dot | Meaning |
|-----|---------|
| 🔴 red | **Needs you** — waiting for permission, waiting for input, or errored |
| 🟡 yellow | Working — generating or running a tool |
| 🟢 green | Idle — alive, your turn |
| 🟣 purple | Compacting context |
| ⚪ grey | No active session |

Each dot is **one Claude session**, so `🟢🟡` means two sessions in that project: one idle, one working. Tiles sort so projects that need you float left.

---

## How it works

Vantage is a single macOS app with two parts running in one process:

```
┌────────────────────────────────────────────┐
│  Menu-bar app (Electrobun, TypeScript)      │  native tray tile + popover + settings
│  • renders the tile via a Swift/CoreText    │
│    helper  • polls the daemon for state     │
└───────────────────────┬────────────────────┘
                        │ in-process (HTTP on 127.0.0.1:7777)
┌───────────────────────▼────────────────────┐
│  vantage-daemon (Bun + Hono) — the brain    │
│  • project registry                         │
│  • session state machine                    │
│  • dev-server (lsof) + Chrome (AppleScript) │
│    detection                                │
│  • HTTP API + actions                       │
└───────────────────────┬────────────────────┘
       Claude Code hooks │ POST /hook
              ┌──────────▼──────────┐
              │  Claude Code        │  (~/.claude/settings.json HTTP hooks)
              └─────────────────────┘
```

- **The signal comes from Claude Code hooks.** On first run, Vantage merges HTTP hooks into `~/.claude/settings.json`. Claude Code then POSTs lifecycle events (`SessionStart`, `PreToolUse`, `PermissionRequest`, `Stop`, `SessionEnd`, …) to the daemon, which runs a state machine to derive each session's status. Hook failures are non‑blocking, so Vantage being down never breaks Claude Code.
- **Projects are the join key.** Everything resolves to a registered project by its absolute path (longest‑prefix match, so monorepo subdirectories map correctly).
- **Detection.** Dev servers are found with `lsof` (the tile/popover show `:port`); Chrome tabs are enumerated with AppleScript.
- **The menu-bar tile is a rendered image.** macOS menu-bar items can only show text or an image, so the tile is drawn by a tiny bundled Swift/CoreText helper (`native/barrender`) for crisp text + colored dots at any size.

Data lives in `~/Library/Application Support/Vantage/` (`projects.json`, `sessions.json`, `logs/`).

---

## Requirements

- **macOS 14+** (Apple Silicon or Intel)
- **[Claude Code](https://claude.com/claude-code)** — the agent Vantage tracks
- Optional: **Google Chrome** (browser tab features), **Cursor** or **VS Code** (open‑editor)
- To build from source: **[Bun](https://bun.sh)** and **Xcode Command Line Tools** (`swiftc`, for the renderer)

---

## Install / run

Vantage isn't distributed as a signed release yet, so for now you build it from source.

```bash
# 1. daemon deps
cd daemon && bun install && cd ..

# 2. ui deps + native renderer + build the .app
cd ui
bun install
bun run barrender          # compile the Swift menu-bar renderer
bun run build              # produces build/<target>/Vantage.app (dev build)
```

Then run it:

```bash
# dev (hot reload, console output)
cd ui && bun run dev

# or open the built app
open ui/build/*/Vantage.app
```

Because the dev build is unsigned, the first launch may be blocked by Gatekeeper — **right‑click the app → Open → Open**. To produce a signed/notarized DMG you have signing set up for: `cd ui && bun run build:release` (gated behind `RELEASE=1`).

On first run Vantage installs its Claude Code hooks automatically. To remove them: `cd daemon && bun run uninstall-hooks`.

---

## Permissions

macOS will prompt for these the first time the relevant feature is used:

- **Automation (System Events / Google Chrome)** — to control Chrome tabs and manage the "open at login" item.
- **Accessibility** — to read the editor window's position for the "opened" flash highlight.

You can manage these under **System Settings → Privacy & Security**.

---

## Limitations

Be aware of these before relying on it:

- **Claude Code only.** The whole status signal is built on Claude Code's hook system. Codex CLI and other agents are **not** supported (no hook ingestion for them yet).
- **Google Chrome only.** Tab detection/focus/close target Chrome. Arc, Safari, Firefox, Brave, and Edge are not supported (Chromium‑based ones would be the easiest to add).
- **Editor is Cursor‑first, then VS Code.** It opens the project in Cursor if installed, else VS Code, else the system default — this isn't configurable yet.
- **Menu-bar tile appears on your *main* display.** With multiple monitors, macOS puts status items on the display set as "main" in System Settings → Displays.
- **macOS only.** No Windows/Linux.
- **Fixed daemon port `7777`** (overridable via `VANTAGE_PORT`).
- **Not signed/notarized** in dev builds → Gatekeeper friction on first open.

---

## Development

```
daemon/        Bun + Hono daemon (the brain)
  src/         registry, sessions/state machine, hooks, detection, actions, HTTP API
  hooks/       install/uninstall Claude Code hooks
  test/        unit + integration tests (bun:test)
ui/            Electrobun menu-bar app
  src/bun/     main process: tray, popover/settings windows, bar renderer client
  src/views/   popover / settings / overlay webviews
  native/      render.swift — the CoreText menu-bar tile renderer
docs/          design spec + implementation plans
```

```bash
# run the daemon test suite
cd daemon && bun test

# type-check the UI
cd ui && bunx tsc --noEmit
```

Useful env vars: `VANTAGE_PORT` (default 7777), `VANTAGE_DATA_DIR` (default `~/Library/Application Support/Vantage`).

---

## Contributing

PRs are very welcome. Good first areas:

- **More agents** — ingest lifecycle events from Codex CLI or others into the daemon's state machine.
- **More browsers** — add Brave/Edge (Chromium) and Safari support to detection/actions.
- **Configurable editor** — per‑project or global editor preference.

Please open an issue or PR describing the change. Keep the daemon agent‑agnostic where possible (it's just a state machine fed by events), and keep new UI consistent with the existing popover/settings style.

---

## License

MIT. See `LICENSE`.
