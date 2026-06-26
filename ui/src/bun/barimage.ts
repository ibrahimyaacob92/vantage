import type { ProjectView, ClaudeStatus } from "./format";
import { join } from "path";

// Status → dot color. Bright on a dark bar; darker/saturated on a light bar
// (bright yellow/green are nearly invisible on a light menu bar).
const COLOR_DARK: Record<ClaudeStatus, string> = {
  blocked_permission: "#ff453a", error: "#ff453a", blocked_input: "#ff453a",
  compacting: "#bf5af0", working: "#ffd60a", idle: "#30d158", gone: "#8e8e93",
};
const COLOR_LIGHT: Record<ClaudeStatus, string> = {
  blocked_permission: "#e0241a", error: "#e0241a", blocked_input: "#e0241a",
  compacting: "#9938cc", working: "#cf8a00", idle: "#1aa34a", gone: "#6d6d72",
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
    "/Applications/Vantage.app/Contents/Resources/app/bin/barrender",
  ];
}

export interface BarRender { pngPath: string; width: number; }

// chmod the renderer binary only once per path (not on every render).
const chmodded = new Set<string>();

/** Render the menu-bar tiles to a crisp @2x PNG via the native (CoreText) helper.
 *  Returns the PNG path + logical width, or null if rendering failed. */
export async function renderBar(views: ProjectView[], dark: boolean): Promise<BarRender | null> {
  // Keep the user's manual order (registry order); just drop hidden projects.
  const sorted = views.filter((v) => (v.project as any).enabled !== false);
  const COLOR = dark ? COLOR_DARK : COLOR_LIGHT;
  const tiles = sorted.map((v) => {
    const sessions = v.claude.sessions.length ? v.claude.sessions : [{ status: v.claude.headline } as any];
    return { code: code4(v), dots: sessions.map((s) => COLOR[(s.status as ClaudeStatus)] ?? COLOR.gone) };
  });
  // Empty state: no projects yet → still show a visible, clickable "Vantage"
  // label so new users can find it and open the popover to add a project.
  const finalTiles = tiles.length ? tiles : [{ code: "Vantage", dots: [] as string[] }];
  const spec = { h: 22, scale: 2, fontSize: 9.5, fg: dark ? [1, 1, 1] : [0.11, 0.11, 0.12], tiles: finalTiles };
  const specPath = "/tmp/Vantage-bar-spec.json";
  const pngPath = "/tmp/Vantage-bar.png";
  try { await Bun.write(specPath, JSON.stringify(spec)); } catch { return null; }

  for (const bin of candidates()) {
    try {
      if (!chmodded.has(bin)) { await Bun.$`chmod +x ${bin}`.quiet().nothrow(); chmodded.add(bin); }
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
