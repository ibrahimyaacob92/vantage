export type ClaudeStatus =
  | "idle" | "working" | "blocked_permission" | "blocked_input"
  | "error" | "compacting" | "gone";

export interface ProjectView {
  project: { id: string; name: string; port: number | null; url: string | null };
  claude: { count: number; headline: ClaudeStatus; needsAttention: boolean; sessions: unknown[] };
  dev: { running: boolean; port: number | null; pid: number | null; managed: boolean };
  browser: { tabOpen: boolean; ref: unknown };
}

export type MenuItemConfig =
  | { type: "divider" | "separator" }
  | { type?: "normal"; label?: string; action?: string; enabled?: boolean; checked?: boolean; hidden?: boolean; tooltip?: string; submenu?: MenuItemConfig[] };

const PRIORITY: ClaudeStatus[] = [
  "blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone",
];
export const DOT: Record<ClaudeStatus, string> = {
  blocked_permission: "🔴", error: "🔴", blocked_input: "🔴",
  compacting: "🟣", working: "🟡", idle: "🔵", gone: "⚪",
};

export function sortViews(views: ProjectView[]): ProjectView[] {
  return [...views].sort(
    (a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline),
  );
}

export function formatBarTitle(views: ProjectView[]): string {
  if (views.length === 0) return "projflow";
  const needs = views.filter((v) => v.claude.needsAttention).length;
  const working = views.filter((v) => v.claude.headline === "working" || v.claude.headline === "compacting").length;
  const idle = views.filter((v) => v.claude.headline === "idle" || v.claude.headline === "gone").length;
  const summary = `🔴${needs} 🟡${working} 🔵${idle}`;
  const list = sortViews(views).map((v) => `${DOT[v.claude.headline]}${v.project.name}`).join(" ");
  return `${summary} ┃ ${list}`;
}

export function buildTrayMenu(views: ProjectView[]): MenuItemConfig[] {
  const menu: MenuItemConfig[] = [];
  for (const v of sortViews(views)) {
    const bits = [DOT[v.claude.headline] + " " + v.project.name, v.claude.headline];
    if (v.dev.running && v.dev.port) bits.push(`:${v.dev.port}`);
    if (v.browser.tabOpen) bits.push("tab");
    menu.push({ label: bits.join(" · "), enabled: false });
  }
  menu.push({ type: "divider" });
  menu.push({ label: "Settings…", action: "settings" });
  menu.push({ label: "Quit projflow", action: "quit" });
  return menu;
}
