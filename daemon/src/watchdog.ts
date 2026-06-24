import type { SessionStore } from "./sessions";

export interface SweepOpts {
  pidAlive: (pid: number) => boolean;
  staleMs: number;
  goneGraceMs: number;
}

/** One watchdog pass. Mutates session statuses via the store's hook path is avoided;
 *  instead we read sessions and re-write the affected ones through a minimal mark. */
export function sweep(store: SessionStore, now: number, opts: SweepOpts): void {
  for (const s of store.all()) {
    if (s.status === "gone") continue;
    const dead = s.pid != null && !opts.pidAlive(s.pid);
    if (dead) {
      store.markStatus(s.sessionId, s.status === "working" ? "error" : "gone", now);
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
    () => sweep(store, Date.now(), { pidAlive: realPidAlive, staleMs: 90_000, goneGraceMs: 10_000 }),
    intervalMs,
  );
}
