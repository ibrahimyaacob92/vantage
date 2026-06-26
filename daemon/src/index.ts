import { Hono } from "hono";
import { config } from "./config";
import { Registry } from "./registry";
import { SessionStore } from "./sessions";
import { handleHook } from "./hooks";
import { buildProjectViews } from "./derive";
import { DetectionStore } from "./detection";
import { PortDetector, realPortDeps } from "./detect-ports";
import { ChromeDetector, realChromeDeps } from "./detect-chrome";
import type { Project } from "./types";

export const app = new Hono();

let registry = new Registry(config.projectsFile);
let store = new SessionStore(config.sessionsFile);
let detection = new DetectionStore();

/** Test seam: swap in temp-backed stores. */
export function __setStores(r: Registry, s: SessionStore, d?: DetectionStore) {
  registry = r; store = s; if (d) detection = d;
}

// Allow the menu-bar app's webview (a different origin) to call the daemon.
app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      },
    });
  }
  await next();
  c.header("Access-Control-Allow-Origin", "*");
});

app.get("/health", (c) => c.json({ ok: true }));

app.post("/hook", async (c) => {
  // Return instantly; never let hook work block the response or throw upstream.
  let payload: any = null;
  try { payload = await c.req.json(); } catch { /* ignore malformed */ }
  if (payload) { try { handleHook(payload, registry, store, Date.now()); } catch { /* swallow */ } }
  return c.json({ ok: true });
});

app.get("/state", (c) => c.json(buildProjectViews(registry.list(), store.all(), detection)));

app.get("/projects", (c) => c.json(registry.list()));
app.post("/projects", async (c) => {
  let p: Project;
  try { p = (await c.req.json()) as Project; } catch { return c.json({ error: "invalid body" }, 400); }
  await registry.add(p);
  return c.json(p, 201);
});
app.put("/projects/:id", async (c) => {
  let patch: Partial<Project>;
  try { patch = (await c.req.json()) as Partial<Project>; } catch { return c.json({ error: "invalid body" }, 400); }
  let updated: Project;
  try { updated = await registry.update(c.req.param("id"), patch); } catch { return c.json({ error: "not found" }, 404); }
  return c.json(updated);
});
app.delete("/projects/:id", async (c) => {
  const id = c.req.param("id");
  if (!registry.get(id)) return c.json({ error: "not found" }, 404);
  await registry.remove(id);
  return c.json({ ok: true });
});
app.post("/actions/projects/reorder", async (c) => {
  let ids: string[] = [];
  try { ids = ((await c.req.json()) as any).ids ?? []; } catch {}
  if (Array.isArray(ids) && ids.length) await registry.reorder(ids.map(String));
  return c.json({ ok: true });
});
app.post("/actions/chrome/refresh", async (c) => {
  await new ChromeDetector(detection, realChromeDeps).refresh(registry.list());
  return c.json({ ok: true });
});

// App-level actions the menu-bar UI triggers (wired by the host app, since the
// daemon runs in-process with it). No-ops if the host hasn't registered them.
type WinBounds = { x: number; y: number; w: number; h: number };
let appActions: { openSettings?: () => void; quit?: () => void; flash?: (b: WinBounds | null) => void; resizePopover?: (h: number) => void } = {};
export function setAppActions(a: typeof appActions) { appActions = a; }

async function chromeBounds(): Promise<WinBounds | null> {
  try {
    const out = (await Bun.$`osascript -e ${'tell application "Google Chrome" to get bounds of front window'}`.quiet().nothrow()).stdout.toString().trim();
    const n = out.split(",").map((s) => parseInt(s.trim(), 10));
    if (n.length === 4 && n.every(Number.isFinite)) return { x: n[0], y: n[1], w: n[2] - n[0], h: n[3] - n[1] };
  } catch { /* Chrome closed */ }
  return null;
}
async function processBounds(proc: string): Promise<WinBounds | null> {
  try {
    const script = `tell application "System Events" to tell process "${proc}" to get {position, size} of front window`;
    const out = (await Bun.$`osascript -e ${script}`.quiet().nothrow()).stdout.toString().trim();
    const n = out.split(",").map((s) => parseInt(s.trim(), 10));
    if (n.length === 4 && n.every(Number.isFinite)) return { x: n[0], y: n[1], w: n[2], h: n[3] };
  } catch { /* needs Accessibility permission */ }
  return null;
}
app.post("/actions/app/settings", (c) => { appActions.openSettings?.(); return c.json({ ok: true }); });
app.post("/actions/app/quit", (c) => { appActions.quit?.(); return c.json({ ok: true }); });
app.post("/actions/app/popover-size", async (c) => {
  let h = 0; try { h = Number(((await c.req.json()) as any).height) || 0; } catch {}
  if (h > 0) appActions.resizePopover?.(h);
  return c.json({ ok: true });
});

// "Open at login" via a macOS Login Item (System Events). The app bundle path
// is derived from where this process runs.
function appBundlePath(): string | null {
  for (const cand of [process.execPath, import.meta.dir]) {
    const i = cand.indexOf(".app/");
    if (i >= 0) return cand.slice(0, i + 4);
  }
  return null;
}
app.get("/actions/app/login-item", async (c) => {
  const appPath = appBundlePath();
  if (!appPath) return c.json({ enabled: false, supported: false });
  try {
    const script = 'tell application "System Events"\nset out to ""\nrepeat with li in login items\nset out to out & (path of li) & linefeed\nend repeat\nreturn out\nend tell';
    const out = (await Bun.$`osascript -e ${script}`.quiet().nothrow()).stdout.toString();
    return c.json({ enabled: out.split("\n").some((l) => l.trim() === appPath), supported: true });
  } catch { return c.json({ enabled: false, supported: true }); }
});
app.post("/actions/app/login-item", async (c) => {
  let enabled = false; try { enabled = !!((await c.req.json()) as any).enabled; } catch {}
  const appPath = appBundlePath();
  if (!appPath) return c.json({ ok: false });
  const script = enabled
    ? `tell application "System Events" to make login item at end with properties {path:${JSON.stringify(appPath)}, hidden:false}`
    : `tell application "System Events" to delete (every login item whose path is ${JSON.stringify(appPath)})`;
  await Bun.$`osascript -e ${script}`.quiet().nothrow();
  return c.json({ ok: true });
});

// Report macOS permission status so Settings can surface a denied permission
// (a user who clicked "Don't Allow" otherwise has a silently-broken app).
app.get("/actions/app/permissions", async (c) => {
  let automation: boolean | null = null;
  let accessibility: boolean | null = null;
  // Automation: can we send Apple events to System Events? (-1743 = denied)
  const r = await Bun.$`osascript -e ${'tell application "System Events" to return (count of processes)'}`.quiet().nothrow();
  if (r.exitCode === 0) {
    automation = true;
    // Accessibility (assistive access) — only readable once Automation is allowed.
    const a = await Bun.$`osascript -e ${'tell application "System Events" to return (UI elements enabled)'}`.quiet().nothrow();
    if (a.exitCode === 0) accessibility = a.stdout.toString().trim() === "true";
  } else {
    automation = false;
  }
  return c.json({ automation, accessibility });
});
app.post("/actions/app/open-privacy", async (c) => {
  let pane = "automation";
  try { const p = ((await c.req.json()) as any).pane; if (p) pane = String(p); } catch {}
  const anchor = pane === "accessibility" ? "Privacy_Accessibility" : "Privacy_Automation";
  await Bun.$`open ${`x-apple.systempreferences:com.apple.preference.security?${anchor}`}`.quiet().nothrow();
  return c.json({ ok: true });
});

// Native macOS folder picker (used by the dashboard's "Browse…" button).
// Runs the system "choose folder" dialog and returns its POSIX path, or
// { canceled: true } if the user dismisses it. Never throws upstream.
app.post("/actions/pick-folder", async (c) => {
  const script = [
    "try",
    'return POSIX path of (choose folder with prompt "Select your project folder")',
    "on error",
    'return ""',
    "end try",
  ].join("\n");
  try {
    const out = (await Bun.$`osascript -e ${script}`.quiet().nothrow()).stdout.toString().trim();
    if (!out) return c.json({ canceled: true });
    return c.json({ path: out.replace(/\/$/, "") });
  } catch {
    return c.json({ canceled: true });
  }
});

// Open/focus the project in the user's editor. Tries Cursor, then VS Code, then
// a plain open. Uses absolute `open` (always on a GUI app's PATH).
app.post("/actions/editor/focus", async (c) => {
  let id = "";
  try { id = ((await c.req.json()) as any).projectId; } catch {}
  const p = registry.get(id);
  if (!p) return c.json({ error: "not found" }, 404);
  let opened = "default";
  for (const appName of ["Cursor", "Visual Studio Code"]) {
    const r = await Bun.$`open -a ${appName} ${p.path}`.quiet().nothrow();
    if (r.exitCode === 0) { opened = appName; break; }
  }
  if (opened === "default") await Bun.$`open ${p.path}`.quiet().nothrow();
  const proc = opened === "Visual Studio Code" ? "Code" : opened === "Cursor" ? "Cursor" : null;
  if (proc) appActions.flash?.(await processBounds(proc));
  return c.json({ ok: true, opened });
});

// Focus an existing Chrome tab for the project's URL, else open a new one.
app.post("/actions/browser/open", async (c) => {
  let id = "";
  try { id = ((await c.req.json()) as any).projectId; } catch {}
  const p = registry.get(id);
  if (!p) return c.json({ error: "not found" }, 404);
  const dev = detection.getDev(p.id);
  const url = p.url || (p.port ? `http://localhost:${p.port}` : dev.port ? `http://localhost:${dev.port}` : null);
  if (!url) return c.json({ error: "no url/port for project" }, 400);
  const needle = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const script = [
    'tell application "Google Chrome"',
    "  set found to false",
    "  repeat with w in windows",
    "    set i to 0",
    "    repeat with t in tabs of w",
    "      set i to i + 1",
    `      if (URL of t) contains ${JSON.stringify(needle)} then`,
    "        set active tab index of w to i",
    "        set index of w to 1",
    "        set found to true",
    "      end if",
    "    end repeat",
    "  end repeat",
    "  if not found then open location " + JSON.stringify(url),
    "  activate",
    "end tell",
  ].join("\n");
  await Bun.$`osascript -e ${script}`.quiet().nothrow();
  appActions.flash?.(await chromeBounds());
  return c.json({ ok: true, url });
});

// List Chrome tabs matching the project's URL/port (id, url, title per tab).
app.post("/actions/browser/tabs", async (c) => {
  let id = "";
  try { id = ((await c.req.json()) as any).projectId; } catch {}
  const p = registry.get(id);
  if (!p) return c.json({ error: "not found" }, 404);
  const dev = detection.getDev(p.id);
  const url = p.url || (p.port ? `http://localhost:${p.port}` : dev.port ? `http://localhost:${dev.port}` : null);
  const needle = url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
  // Without a URL/port we can't match tabs to this project — return none
  // (rather than every tab in Chrome).
  if (!needle) return c.json({ tabs: [], url: null });
  const script = [
    'tell application "Google Chrome"',
    '  set out to ""',
    "  repeat with w from 1 to count windows",
    "    repeat with t from 1 to count tabs of window w",
    "      set tb to tab t of window w",
    '      set out to out & (id of tb) & "\\t" & (URL of tb) & "\\t" & (title of tb) & "\\n"',
    "    end repeat",
    "  end repeat",
    "  return out",
    "end tell",
  ].join("\n");
  let tabs: { id: string; url: string; title: string }[] = [];
  try {
    const out = (await Bun.$`osascript -e ${script}`.quiet().nothrow()).stdout.toString();
    for (const line of out.split("\n")) {
      const parts = line.split("\t");
      if (parts.length >= 2 && parts[0]) tabs.push({ id: parts[0], url: parts[1] ?? "", title: parts.slice(2).join("\t") });
    }
  } catch { /* Chrome closed */ }
  if (needle) tabs = tabs.filter((t) => t.url.includes(needle));
  return c.json({ tabs, url });
});

function tabActionScript(tabId: string, verb: "focus" | "close"): string {
  const action = verb === "close"
    ? '        close tab t of window w'
    : '        set active tab index of window w to t\n        set index of window w to 1\n        activate';
  return [
    'tell application "Google Chrome"',
    "  repeat with w from 1 to count windows",
    "    repeat with t from 1 to count tabs of window w",
    `      if ((id of tab t of window w) as text) is "${tabId}" then`,
    action,
    '        return "ok"',
    "      end if",
    "    end repeat",
    "  end repeat",
    "end tell",
  ].join("\n");
}
app.post("/actions/browser/focus-tab", async (c) => {
  let tabId = "";
  try { tabId = String(((await c.req.json()) as any).tabId).replace(/[^0-9]/g, ""); } catch {}
  if (!tabId) return c.json({ error: "no tab" }, 400);
  await Bun.$`osascript -e ${tabActionScript(tabId, "focus")}`.quiet().nothrow();
  appActions.flash?.(await chromeBounds());
  return c.json({ ok: true });
});
app.post("/actions/browser/close-tab", async (c) => {
  let tabId = "";
  try { tabId = String(((await c.req.json()) as any).tabId).replace(/[^0-9]/g, ""); } catch {}
  if (!tabId) return c.json({ error: "no tab" }, 400);
  await Bun.$`osascript -e ${tabActionScript(tabId, "close")}`.quiet().nothrow();
  return c.json({ ok: true });
});

/**
 * Boot the daemon in the current process: bind the HTTP server, load state,
 * start the watchdog + port detector. Returns true if this process now owns
 * the daemon, or false if the port is already taken (another daemon is running
 * — callers should just use it over HTTP). Safe to call from the menu-bar app
 * so Vantage runs as a single program.
 */
export async function startDaemon(): Promise<boolean> {
  try {
    Bun.serve({ port: config.port, hostname: "127.0.0.1", fetch: app.fetch });
  } catch {
    console.log(`vantage: port ${config.port} in use — using the existing daemon`);
    return false;
  }
  // One-time migration from the old projflow data dir so users keep their projects.
  try {
    const { existsSync, renameSync } = await import("fs");
    const { legacyDataDir } = await import("./config");
    if (!existsSync(config.dataDir) && existsSync(legacyDataDir)) renameSync(legacyDataDir, config.dataDir);
  } catch { /* non-fatal */ }
  await registry.load();
  await store.load();
  // Self-install Claude Code hooks on first run so a freshly-installed app
  // actually receives session events (idempotent; preserves existing hooks).
  try { const { ensureHooksInstalled } = await import("../hooks/install"); await ensureHooksInstalled(config.port); } catch { /* non-fatal */ }
  const { startWatchdog } = await import("./watchdog");
  startWatchdog(store);
  new PortDetector(detection, realPortDeps).start(() => registry.list(), 4000);
  console.log(`Vantage daemon listening on http://127.0.0.1:${config.port}`);
  return true;
}

if (import.meta.main) {
  await startDaemon();
}
