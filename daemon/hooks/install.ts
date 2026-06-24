import { homedir } from "os";
import { join } from "path";

export const HOOK_EVENTS = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolBatch",
  "PermissionRequest", "Notification", "Stop", "StopFailure", "PostToolUseFailure",
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "SessionEnd",
] as const;

const TAG = "projflow: state hook";
const isProjflow = (entry: any) => typeof entry?.description === "string" && entry.description.startsWith("projflow:");

/** Pure: return new settings with projflow HTTP hooks merged in, existing hooks untouched. */
export function mergeHooks(existing: any, url: string): any {
  const out = structuredClone(existing ?? {});
  out.hooks ??= {};
  for (const ev of HOOK_EVENTS) {
    const list = (out.hooks[ev] ??= []);
    const filtered = list.filter((e: any) => !isProjflow(e)); // drop old projflow entries (idempotent)
    filtered.push({
      matcher: "",
      description: TAG,
      hooks: [{ type: "http", url, timeout: 5 }],
    });
    out.hooks[ev] = filtered;
  }
  return out;
}

/** Pure: remove only projflow-tagged entries; drop now-empty event arrays. */
export function stripHooks(existing: any): any {
  const out = structuredClone(existing ?? {});
  if (!out.hooks) return out;
  for (const ev of Object.keys(out.hooks)) {
    out.hooks[ev] = (out.hooks[ev] as any[]).filter((e) => !isProjflow(e));
    if (out.hooks[ev].length === 0) delete out.hooks[ev];
  }
  return out;
}

const settingsPath = join(homedir(), ".claude", "settings.json");

if (import.meta.main) {
  const url = `http://127.0.0.1:${process.env.PROJFLOW_PORT ?? 7777}/hook`;
  const f = Bun.file(settingsPath);
  const existing = (await f.exists()) ? await f.json() : {};
  await Bun.write(settingsPath, JSON.stringify(mergeHooks(existing, url), null, 2));
  console.log(`Installed projflow hooks into ${settingsPath} (${HOOK_EVENTS.length} events).`);
}
