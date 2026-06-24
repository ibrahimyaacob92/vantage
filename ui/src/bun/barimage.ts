import type { ProjectView, ClaudeStatus } from "./format";

// Status → dot color (used in the rendered menu-bar image, not emoji).
const COLOR: Record<ClaudeStatus, string> = {
  blocked_permission: "#ff453a", error: "#ff453a", blocked_input: "#ff453a",
  compacting: "#bf5af0", working: "#ffd60a", idle: "#0a84ff", gone: "#8e8e93",
};
const PRIORITY: ClaudeStatus[] = [
  "blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone",
];

const cairo = ["/opt/homebrew/bin/cairosvg", "/usr/local/bin/cairosvg", "cairosvg"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const code4 = (v: ProjectView): string =>
  ((v.project as any).code || v.project.name).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "····";

/** Build the menu-bar SVG: per project a 2-row tile — tiny code on top, a row
 *  of colored session dots below (one per active session). No leading icon. */
export function buildBarSvg(views: ProjectView[], dark: boolean): { svg: string; width: number } {
  const fg = dark ? "#ffffff" : "#1d1d1f";
  const sorted = [...views].sort((a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline));
  const H = 22;
  // Calibrated to match macOS menu-bar label size (e.g. Stats' "RAM").
  const FONT = `font-family="SF Pro Text, -apple-system, Helvetica" font-size="5.2" font-weight="500" letter-spacing="0.2"`;
  const DOT_STEP = 3.4, DOT_R = 1.15;
  const CODE_Y = 12, DOTS_Y = 15.6; // shifted lower, rows close together
  const parts: string[] = [];
  let x = 5;

  sorted.forEach((v, i) => {
    const code = code4(v);
    const sessions = v.claude.sessions.length ? v.claude.sessions : [{ status: v.claude.headline } as any];
    const codeW = code.length * 3.1;
    const dotsW = Math.max((sessions.length - 1) * DOT_STEP + DOT_R * 2, DOT_R * 2);
    const tileW = Math.max(codeW, dotsW);
    // top row: code
    parts.push(`<text x="${(x + tileW / 2).toFixed(1)}" y="${CODE_Y}" ${FONT} text-anchor="middle" fill="${fg}">${esc(code)}</text>`);
    // bottom row: dots, centered under the tile, snug below the code
    let dx = x + tileW / 2 - ((sessions.length - 1) * DOT_STEP) / 2;
    for (const s of sessions) {
      parts.push(`<circle cx="${dx.toFixed(1)}" cy="${DOTS_Y}" r="${DOT_R}" fill="${COLOR[(s.status as ClaudeStatus)] ?? "#8e8e93"}"/>`);
      dx += DOT_STEP;
    }
    x += tileW;
    if (i < sorted.length - 1) {
      parts.push(`<rect x="${(x + 3).toFixed(1)}" y="7" width="0.6" height="9" rx="0.3" fill="${fg}" opacity="0.15"/>`);
      x += 6;
    }
  });

  const width = Math.max(Math.ceil(x + 5), 16);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">${parts.join("")}</svg>`;
  return { svg, width };
}

/** Render the bar SVG to a PNG via cairosvg (2x for retina). Returns the PNG path, or null on failure. */
export async function renderBarPng(views: ProjectView[], dark: boolean): Promise<string | null> {
  const { svg, width } = buildBarSvg(views, dark);
  const svgPath = "/tmp/projflow-bar.svg";
  const pngPath = "/tmp/projflow-bar.png";
  try {
    await Bun.write(svgPath, svg);
    for (const bin of cairo) {
      try {
        // Render @2x: the tray treats the image as retina (2x), so height 44px → 22pt bar height.
        const proc = Bun.spawn([bin, svgPath, "-o", pngPath, "--output-width", String(width * 2), "--output-height", "44"], { stdout: "ignore", stderr: "ignore" });
        const ok = (await proc.exited) === 0;
        if (ok) return pngPath;
      } catch { /* try next path */ }
    }
  } catch { /* fall through */ }
  return null;
}
