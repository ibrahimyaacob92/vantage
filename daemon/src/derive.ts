import type { Project, Session, ProjectView, ClaudeStatus } from "./types";
import type { DetectionStore } from "./detection";

const PRIORITY: ClaudeStatus[] = [
  "blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone",
];

export function headline(statuses: ClaudeStatus[]): ClaudeStatus {
  for (const s of PRIORITY) if (statuses.includes(s)) return s;
  return "gone";
}

export function isNeedsAttention(h: ClaudeStatus): boolean {
  return h === "blocked_permission" || h === "blocked_input" || h === "error";
}

export function buildProjectViews(
  projects: Project[],
  sessions: Session[],
  detection?: DetectionStore,
): ProjectView[] {
  return projects.map((project) => {
    const mine = sessions.filter((s) => s.projectId === project.id && s.status !== "gone");
    const h = headline(mine.map((s) => s.status));
    const dev = detection
      ? detection.getDev(project.id)
      : { running: false, port: project.port, pid: null, managed: false };
    const browser = detection ? detection.getBrowser(project.id) : { tabOpen: false, ref: null };
    return {
      project,
      claude: {
        count: mine.length,
        headline: h,
        needsAttention: mine.length > 0 && isNeedsAttention(h),
        sessions: mine.map((s) => ({
          sessionId: s.sessionId, status: s.status, detail: s.detail,
          model: s.model, contextPct: s.contextPct,
        })),
      },
      dev,
      browser,
    };
  });
}
