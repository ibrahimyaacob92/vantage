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
  const { startWatchdog } = await import("./watchdog");
  startWatchdog(store);
  Bun.serve({ port: config.port, hostname: "127.0.0.1", fetch: app.fetch });
  console.log(`projd listening on http://127.0.0.1:${config.port}`);
}
