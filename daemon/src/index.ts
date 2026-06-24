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
app.post("/actions/chrome/refresh", async (c) => {
  await new ChromeDetector(detection, realChromeDeps).refresh(registry.list());
  return c.json({ ok: true });
});

/**
 * Boot the daemon in the current process: bind the HTTP server, load state,
 * start the watchdog + port detector. Returns true if this process now owns
 * the daemon, or false if the port is already taken (another daemon is running
 * — callers should just use it over HTTP). Safe to call from the menu-bar app
 * so projflow runs as a single program.
 */
export async function startDaemon(): Promise<boolean> {
  try {
    Bun.serve({ port: config.port, hostname: "127.0.0.1", fetch: app.fetch });
  } catch {
    console.log(`projd: port ${config.port} in use — using the existing daemon`);
    return false;
  }
  await registry.load();
  await store.load();
  const { startWatchdog } = await import("./watchdog");
  startWatchdog(store);
  new PortDetector(detection, realPortDeps).start(() => registry.list(), 4000);
  console.log(`projd listening on http://127.0.0.1:${config.port}`);
  return true;
}

if (import.meta.main) {
  await startDaemon();
}
