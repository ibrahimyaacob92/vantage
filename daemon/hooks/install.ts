import { homedir } from "os";
import { join } from "path";

export const HOOK_EVENTS = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolBatch",
  "PermissionRequest", "Notification", "Stop", "StopFailure", "PostToolUseFailure",
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "SessionEnd",
] as const;

const TAG = "vantage: state hook";
const isVantage = (entry: any) => typeof entry?.description === "string" && entry.description.startsWith("vantage:");
// Also recognize the old "projflow:" tag so installing cleans up legacy hooks.
const isOurs = (entry: any) => typeof entry?.description === "string" &&
  (entry.description.startsWith("vantage:") || entry.description.startsWith("projflow:"));

/** Pure: return new settings with Vantage HTTP hooks merged in, existing hooks untouched. */
export function mergeHooks(existing: any, url: string): any {
  const out = structuredClone(existing ?? {});
  out.hooks ??= {};
  for (const ev of HOOK_EVENTS) {
    const list = (out.hooks[ev] ??= []);
    const filtered = list.filter((e: any) => !isOurs(e)); // drop old entries (idempotent + legacy cleanup)
    filtered.push({
      matcher: "",
      description: TAG,
      hooks: [{ type: "http", url, timeout: 5 }],
    });
    out.hooks[ev] = filtered;
  }
  return out;
}

/** Pure: remove Vantage (and legacy projflow) tagged entries; drop empty arrays. */
export function stripHooks(existing: any): any {
  const out = structuredClone(existing ?? {});
  if (!out.hooks) return out;
  for (const ev of Object.keys(out.hooks)) {
    out.hooks[ev] = (out.hooks[ev] as any[]).filter((e) => !isOurs(e));
    if (out.hooks[ev].length === 0) delete out.hooks[ev];
  }
  return out;
}

const settingsPath = join(homedir(), ".claude", "settings.json");

/** Idempotently ensure Vantage's hooks are in ~/.claude/settings.json. Returns
 *  true if it installed them now, false if already present (or on failure).
 *  Safe to call on every launch — it preserves any existing user hooks. */
export async function ensureHooksInstalled(port = Number(process.env.VANTAGE_PORT ?? process.env.PROJFLOW_PORT ?? 7777)): Promise<boolean> {
  try {
    const f = Bun.file(settingsPath);
    let existing: any = {};
    if (await f.exists()) { try { existing = await f.json(); } catch { existing = {}; } }
    const already = existing?.hooks && Object.values(existing.hooks).some(
      (arr: any) => Array.isArray(arr) && arr.some(isVantage),
    );
    if (already) return false;
    const { mkdir } = await import("fs/promises");
    await mkdir(join(homedir(), ".claude"), { recursive: true });
    await Bun.write(settingsPath, JSON.stringify(mergeHooks(existing, `http://127.0.0.1:${port}/hook`), null, 2));
    return true;
  } catch { return false; }
}

if (import.meta.main) {
  const url = `http://127.0.0.1:${process.env.VANTAGE_PORT ?? process.env.PROJFLOW_PORT ?? 7777}/hook`;
  const f = Bun.file(settingsPath);
  const existing = (await f.exists()) ? await f.json() : {};
  await Bun.write(settingsPath, JSON.stringify(mergeHooks(existing, url), null, 2));
  console.log(`Installed Vantage hooks into ${settingsPath} (${HOOK_EVENTS.length} events).`);
}
