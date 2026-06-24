import type { Project } from "./types";
import { resolveProjectId } from "./resolve";
import type { DetectionStore } from "./detection";

export interface ListenSocket { pid: number; port: number; }

export function parseLsofListen(output: string): ListenSocket[] {
  const out: ListenSocket[] = [];
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1)) || null;
    else if (line.startsWith("n") && pid != null) {
      const m = line.match(/:(\d+)$/);
      if (m) out.push({ pid, port: Number(m[1]) });
    }
  }
  return out;
}

export function parsePidCwd(output: string): string | null {
  for (const line of output.split("\n")) if (line.startsWith("n")) return line.slice(1);
  return null;
}

export interface PortDetectorDeps {
  listSockets: () => Promise<string>;            // lsof -nP -iTCP -sTCP:LISTEN -F pn
  pidCwd: (pid: number) => Promise<string>;      // lsof -a -d cwd -p <pid> -F n
}

export class PortDetector {
  constructor(private store: DetectionStore, private deps: PortDetectorDeps) {}

  async sweep(projects: Project[]): Promise<void> {
    let seen: string[] = [];
    try {
      const sockets = parseLsofListen(await this.deps.listSockets());
      const cwdCache = new Map<number, string | null>();
      for (const { pid, port } of sockets) {
        if (!cwdCache.has(pid)) {
          try { cwdCache.set(pid, parsePidCwd(await this.deps.pidCwd(pid))); }
          catch { cwdCache.set(pid, null); }
        }
        const cwd = cwdCache.get(pid);
        if (!cwd) continue;
        const projectId = resolveProjectId(cwd, projects);
        if (!projectId) continue;
        // keep an already-managed entry's flag; otherwise mark detected
        const prev = this.store.getDev(projectId);
        this.store.setDev(projectId, { running: true, port, pid, managed: prev.managed });
        seen.push(projectId);
      }
    } catch { /* lsof failed — treat as nothing listening */ }
    this.store.clearDevExcept(seen);
  }

  start(getProjects: () => Project[], intervalMs = 4000) {
    return setInterval(() => { void this.sweep(getProjects()); }, intervalMs);
  }
}

// Real command runners (used in index.ts wiring).
export const realPortDeps: PortDetectorDeps = {
  listSockets: async () =>
    (await Bun.$`lsof -nP -iTCP -sTCP:LISTEN -F pn`.quiet().nothrow()).stdout.toString(),
  pidCwd: async (pid: number) =>
    (await Bun.$`lsof -a -d cwd -p ${pid} -F n`.quiet().nothrow()).stdout.toString(),
};
