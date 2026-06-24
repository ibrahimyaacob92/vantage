import { Hono } from "hono";
import { config } from "./config";

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// Only listen when run directly, not when imported by tests.
if (import.meta.main) {
  Bun.serve({ port: config.port, hostname: "127.0.0.1", fetch: app.fetch });
  console.log(`projd listening on http://127.0.0.1:${config.port}`);
}
