import type { ProjectView } from "./format";

export const DAEMON = "http://127.0.0.1:7777";

async function j<T>(p: Promise<Response>, fallback: T): Promise<T> {
  try { const r = await p; return (await r.json()) as T; } catch { return fallback; }
}

export const fetchState = () => j<ProjectView[]>(fetch(`${DAEMON}/state`), []);
export const listProjects = () => j<any[]>(fetch(`${DAEMON}/projects`), []);
export const createProject = (p: any) =>
  j(fetch(`${DAEMON}/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) }), null);
export const updateProject = (id: string, patch: any) =>
  j(fetch(`${DAEMON}/projects/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }), null);
export const deleteProject = (id: string) => j(fetch(`${DAEMON}/projects/${id}`, { method: "DELETE" }), null);
export const refreshChrome = () => j(fetch(`${DAEMON}/actions/chrome/refresh`, { method: "POST" }), null);
