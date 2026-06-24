import { test, expect } from "bun:test";
import { app } from "../src/index";

test("GET /health returns ok", async () => {
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
