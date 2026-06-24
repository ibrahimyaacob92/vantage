import type { Session, ClaudeStatus, HookPayload } from "./types";

export function newSession(sessionId: string, cwd: string, now: number): Session {
  return {
    sessionId, cwd, projectId: null, status: "idle", detail: null, pid: null,
    subagents: 0, model: null, tokens: null, contextPct: null, transcriptPath: null,
    lastEventAt: now, lastEvent: "init",
  };
}

/** Pure: returns a new Session reflecting the hook event. Never mutates input. */
export function transition(session: Session, payload: HookPayload, now: number): Session {
  const s: Session = { ...session, lastEventAt: now, lastEvent: payload.hook_event_name };
  const set = (status: ClaudeStatus, detail: string | null = s.detail) => { s.status = status; s.detail = detail; };

  switch (payload.hook_event_name) {
    case "SessionStart":
      if (payload.pid != null) s.pid = payload.pid;
      if (payload.transcript_path) s.transcriptPath = payload.transcript_path;
      set("idle", null);
      break;
    case "UserPromptSubmit": set("working", null); break;
    case "PreToolUse": set("working", payload.tool_name ?? null); break;
    case "PostToolUse":
    case "PostToolBatch": set("working"); break;
    case "PostToolUseFailure": s.detail = `error: ${payload.error?.subtype ?? "tool failed"}`; break;
    case "PermissionRequest": set("blocked_permission"); break;
    case "Notification": {
      const t = payload.notification?.type;
      if (t === "permission_prompt") set("blocked_permission");
      else if (t === "idle_prompt") set("blocked_input");
      else if (t === "elicitation_dialog") set("blocked_input", "MCP input");
      // else ignore
      break;
    }
    case "Stop": set("idle"); break;
    case "StopFailure": set("error", payload.error?.subtype ?? "error"); break;
    case "SubagentStart": s.subagents += 1; set("working", `working, ${s.subagents} agents`); break;
    case "SubagentStop": s.subagents = Math.max(0, s.subagents - 1); break;
    case "PreCompact": set("compacting"); break;
    case "PostCompact": set("working"); break;
    case "SessionEnd": set("gone"); break;
    // default: heartbeat only (lastEventAt already bumped)
  }
  return s;
}
