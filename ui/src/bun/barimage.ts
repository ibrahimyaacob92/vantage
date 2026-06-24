import type { ProjectView, ClaudeStatus } from "./format";
import { join } from "path";

// Status → dot color in the rendered menu-bar tile.
const COLOR: Record<ClaudeStatus, string> = {
  blocked_permission: "#ff453a", error: "#ff453a", blocked_input: "#ff453a",
  compacting: "#bf5af0", working: "#ffd60a", idle: "#0a84ff", gone: "#8e8e93",
};
const PRIORITY: ClaudeStatus[] = [
  "blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone",
];
const code4 = (v: ProjectView): string =>
  (((v.project as any).code || v.project.name) as string).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "····";

// The native renderer binary, bundled at Resources/app/bin/barrender. Dev paths
// included as fallbacks.
function candidates(): string[] {
  return [
    join(import.meta.dir, "..", "bin", "barrender"),
    join(import.meta.dir, "..", "..", "native", "barrender"),
    "/Applications/projflow.app/Contents/Resources/app/bin/barrender",
  ];
}

export interface BarRender { pngPath: string; width: number; }

/** Render the menu-bar tiles to a crisp @2x PNG via the native (CoreText) helper.
 *  Returns the PNG path + logical width, or null if rendering failed. */
export async function renderBar(views: ProjectView[], dark: boolean): Promise<BarRender | null> {
  const sorted = [...views].sort((a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline));
  const tiles = sorted.map((v) => {
    const sessions = v.claude.sessions.length ? v.claude.sessions : [{ status: v.claude.headline } as any];
    return { code: code4(v), dots: sessions.map((s) => COLOR[(s.status as ClaudeStatus)] ?? "#8e8e93") };
  });
  const spec = { h: 22, scale: 2, fontSize: 8.5, fg: dark ? [1, 1, 1] : [0.11, 0.11, 0.12], tiles };
  const specPath = "/tmp/projflow-bar-spec.json";
  const pngPath = "/tmp/projflow-bar.png";
  try { await Bun.write(specPath, JSON.stringify(spec)); } catch { return null; }

  for (const bin of candidates()) {
    try {
      await Bun.$`chmod +x ${bin}`.quiet().nothrow();
      const proc = Bun.spawn([bin, specPath, pngPath], { stdout: "pipe", stderr: "ignore" });
      const out = await new Response(proc.stdout).text();
      if ((await proc.exited) === 0) {
        const w = parseInt(out.trim(), 10);
        return { pngPath, width: Math.max(Number.isFinite(w) ? w : 0, 8) };
      }
    } catch { /* try next candidate */ }
  }
  return null;
}
