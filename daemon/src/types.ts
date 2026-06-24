export type ClaudeStatus =
  | "idle" | "working" | "blocked_permission" | "blocked_input"
  | "error" | "compacting" | "gone";

export interface Project {
  id: string;
  name: string;
  code?: string;         // 4-letter menu-bar code (defaults to first 4 of name)
  path: string;          // absolute dir — the join key
  devCommand: string;
  port: number | null;
  url: string | null;
  enabled: boolean;
}

export interface Session {
  sessionId: string;
  cwd: string;
  projectId: string | null;
  status: ClaudeStatus;
  detail: string | null;
  pid: number | null;
  subagents: number;
  model: string | null;
  tokens: { input: number; output: number; total: number } | null;
  contextPct: number | null;
  transcriptPath: string | null;
  lastEventAt: number;   // epoch ms
  lastEvent: string;
}

export interface DevServer {
  projectId: string;
  pid: number | null;
  port: number | null;
  status: "starting" | "running" | "stopped" | "crashed";
  startedAt: number | null;
  logFile: string;
  managed: boolean;
}

export interface ProjectView {
  project: Project;
  claude: {
    count: number;
    headline: ClaudeStatus;
    needsAttention: boolean;
    sessions: Pick<Session, "sessionId" | "status" | "detail" | "model" | "contextPct">[];
  };
  dev: { running: boolean; port: number | null; pid: number | null; managed: boolean };
  browser: { tabOpen: boolean; ref: { windowIndex: number; tabIndex: number } | null };
}

// Raw Claude Code hook payload (only the fields Phase 1 reads).
export interface HookPayload {
  hook_event_name: string;        // e.g. "PreToolUse"
  session_id: string;
  cwd: string;
  transcript_path?: string;
  pid?: number;
  tool_name?: string;
  notification?: { type?: string; [k: string]: unknown };
  error?: { subtype?: string; [k: string]: unknown };
  [k: string]: unknown;
}
