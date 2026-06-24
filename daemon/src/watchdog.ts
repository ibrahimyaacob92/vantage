import type { SessionStore } from "./sessions";

export interface SweepOpts {
  pidAlive: (pid: number) => boolean;
  goneGraceMs: number;
}

/** One watchdog pass. Mutates session statuses via the store's hook path is avoided;
 *  instead we read sessions and re-write the affected ones through a minimal mark. */
export function sweep(store: SessionStore, now: number, opts: SweepOpts): void {
  for (const s of store.all()) {
    if (s.status === "gone") continue;
    const dead = s.pid != null && !opts.pidAlive(s.pid);
    if (dead) {
      if (s.status === "working") {
        // First detection of a dead working process: surface the failure
        store.markStatus(s.sessionId, "error", now);
      } else if (s.status === "error") {
        // A prior sweep already surfaced the failure and pid is still dead: enroll in grace reaper
        store.markStatus(s.sessionId, "gone", now);
      } else {
        // idle / waiting / any other non-gone status with dead pid -> gone directly
        store.markStatus(s.sessionId, "gone", now);
      }
    }
    // live pid + stale heartbeat while working => leave as working (long tool runs are normal)
  }
  store.removeGone(now, opts.goneGraceMs);
}

export function realPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function startWatchdog(store: SessionStore, intervalMs = 20_000) {
  return setInterval(
    () => sweep(store, Date.now(), { pidAlive: realPidAlive, goneGraceMs: 10_000 }),
    intervalMs,
  );
}
