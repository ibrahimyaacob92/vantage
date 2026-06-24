import { mkdirSync } from "fs";
import { dirname } from "path";
import type { Session, Project, HookPayload } from "./types";
import { newSession, transition } from "./state-machine";
import { resolveProjectId } from "./resolve";

export class SessionStore {
  private sessions = new Map<string, Session>();
  private goneAt = new Map<string, number>();
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    const f = Bun.file(this.filePath);
    if (await f.exists()) {
      const arr = (await f.json()) as Session[];
      this.sessions = new Map(arr.map((s) => [s.sessionId, s]));
    }
  }

  all(): Session[] { return [...this.sessions.values()]; }
  get(id: string): Session | undefined { return this.sessions.get(id); }

  upsertFromHook(payload: HookPayload, projects: Project[], now: number): Session {
    const id = payload.session_id;
    const existing = this.sessions.get(id) ?? newSession(id, payload.cwd, now);
    const next = transition(existing, payload, now);
    const stored = next.projectId ? next : { ...next, projectId: resolveProjectId(payload.cwd, projects) };
    this.sessions.set(id, stored);
    if (stored.status === "gone") this.goneAt.set(id, now); else this.goneAt.delete(id);
    this.mirror();
    return stored;
  }

  markStatus(id: string, status: import("./types").ClaudeStatus, now: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const next = { ...s, status, lastEventAt: now, lastEvent: "watchdog" };
    this.sessions.set(id, next);
    if (status === "gone") this.goneAt.set(id, now);
    else this.goneAt.delete(id);
    this.mirror();
  }

  removeGone(now: number, graceMs: number): void {
    for (const [id, at] of this.goneAt) {
      if (now - at >= graceMs) { this.sessions.delete(id); this.goneAt.delete(id); }
    }
    this.mirror();
  }

  private mirror(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      void Bun.write(this.filePath, JSON.stringify(this.all(), null, 2)).catch(() => {});
    } catch { /* mirror is best-effort; never block a hook */ }
  }
}
