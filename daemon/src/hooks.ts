import type { HookPayload } from "./types";
import type { Registry } from "./registry";
import type { SessionStore } from "./sessions";

/** Apply one hook to state. Cheap + synchronous so POST /hook can return instantly. */
export function handleHook(payload: HookPayload, registry: Registry, store: SessionStore, now: number): void {
  if (!payload?.session_id || !payload?.hook_event_name) return;
  store.upsertFromHook(payload, registry.list(), now);
}
