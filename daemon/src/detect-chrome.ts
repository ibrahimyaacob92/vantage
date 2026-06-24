import type { Project } from "./types";
import type { DetectionStore } from "./detection";

export interface ChromeTab { windowIndex: number; tabIndex: number; url: string; }

export function parseChromeTabs(output: string): ChromeTab[] {
  const out: ChromeTab[] = [];
  for (const line of output.split("\n")) {
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const wi = Number(parts[0]); const ti = Number(parts[1]);
    if (!wi || !ti) continue;
    out.push({ windowIndex: wi, tabIndex: ti, url: parts.slice(2).join("|") });
  }
  return out;
}

export function matchTab(project: Project, tabs: ChromeTab[]): ChromeTab | null {
  if (project.url) {
    const base = project.url.replace(/\/$/, "");
    const hit = tabs.find((t) => t.url.startsWith(base));
    if (hit) return hit;
  }
  if (project.port != null) {
    const needle = `:${project.port}`;
    const hit = tabs.find((t) => t.url.includes(needle));
    if (hit) return hit;
  }
  return null;
}

export interface ChromeDetectorDeps { enumerate: () => Promise<string>; }

export class ChromeDetector {
  constructor(private store: DetectionStore, private deps: ChromeDetectorDeps) {}

  async refresh(projects: Project[]): Promise<void> {
    let seen: string[] = [];
    try {
      const tabs = parseChromeTabs(await this.deps.enumerate());
      for (const p of projects) {
        const t = matchTab(p, tabs);
        if (t) {
          this.store.setBrowser(p.id, { tabOpen: true, ref: { windowIndex: t.windowIndex, tabIndex: t.tabIndex } });
          seen.push(p.id);
        }
      }
    } catch { /* AppleScript failed / Chrome closed — nothing open */ }
    this.store.clearBrowserExcept(seen);
  }
}

// Real enumerator (used in index.ts). Emits wi|ti|url rows.
const ENUM_SCRIPT = `tell application "Google Chrome"
  set out to {}
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      set end of out to (wi & "|" & ti & "|" & (URL of t))
    end repeat
  end repeat
  set AppleScript's text item delimiters to linefeed
  return out as text
end tell`;

export const realChromeDeps: ChromeDetectorDeps = {
  enumerate: async () =>
    (await Bun.$`osascript -e ${ENUM_SCRIPT}`.quiet().nothrow()).stdout.toString(),
};
