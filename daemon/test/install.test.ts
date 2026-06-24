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
