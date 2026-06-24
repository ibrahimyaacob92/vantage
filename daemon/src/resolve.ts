import type { Project } from "./types";

/** Longest-prefix match of cwd against project.path, on path-segment boundaries. */
export function resolveProjectId(cwd: string, projects: Project[]): string | null {
  const norm = (p: string) => (p.endsWith("/") ? p.slice(0, -1) : p);
  const c = norm(cwd);
  let best: Project | null = null;
  for (const p of projects) {
    const base = norm(p.path);
    if (c === base || c.startsWith(base + "/")) {
      if (!best || base.length > norm(best.path).length) best = p;
    }
  }
  return best ? best.id : null;
}
