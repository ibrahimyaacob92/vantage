# Contributing to Vantage

Thanks for your interest! Vantage is a small, focused macOS app and PRs are very welcome.

## Project layout

```
daemon/        Bun + Hono daemon (the "brain")
  src/         registry, sessions/state machine, hooks routing, detection, actions, HTTP API
  hooks/       install/uninstall Claude Code hooks
  test/        unit + integration tests (bun:test)
ui/            Electrobun menu-bar app
  src/bun/     main process: tray, popover/settings windows, bar-renderer client
  src/views/   popover / settings / overlay webviews (HTML + TS)
  native/      render.swift — the CoreText menu-bar tile renderer
docs/          design spec + implementation plans
```

## Dev setup

Requirements: **macOS 14+**, **[Bun](https://bun.sh)**, **Xcode Command Line Tools** (`swiftc`).

```bash
# daemon
cd daemon && bun install

# ui
cd ../ui && bun install
bun run barrender      # compile the Swift menu-bar renderer
bun run dev            # run with hot reload + console output
```

On first run the app installs its Claude Code hooks into `~/.claude/settings.json`. Remove them with `cd daemon && bun run uninstall-hooks`.

## Before you open a PR

- **Daemon tests pass:** `cd daemon && bun test`
- **UI type-checks:** `cd ui && bunx tsc --noEmit`
- If you changed `native/render.swift`, recompile: `cd ui && bun run barrender`
- Keep the change focused; describe what and why in the PR.

## Conventions

- **Keep the daemon agent-agnostic.** It's a state machine fed by lifecycle events — avoid hard-coding assumptions that only make sense for one agent or tool where you can avoid it.
- **The daemon must never break the agent.** `POST /hook` returns immediately and never throws upstream; failures degrade gracefully.
- **Match existing UI style.** New webview UI should follow the popover/settings look (CSS variables, dark-mode aware, the shared status colors).
- **TypeScript, no new heavy deps** unless there's a clear reason.

## Good first areas

- **More agents** — ingest lifecycle events from Codex CLI or other agents into the daemon's state machine (a new installer + an event→status mapping).
- **More browsers** — add Brave/Edge (Chromium, easy) and Safari to detection + tab actions.
- **Configurable editor** — a per-project or global editor preference instead of Cursor-first.
- **Tests** — more coverage around detection and the action endpoints.

## Reporting bugs

Open an issue with: macOS version, what you did, what you expected, and what happened (include any output from `cd ui && bun run dev`).

By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
