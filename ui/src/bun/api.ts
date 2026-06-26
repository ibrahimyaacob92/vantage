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
export const reorderProjects = (ids: string[]) =>
  j(fetch(`${DAEMON}/actions/projects/reorder`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }), null);
export const refreshChrome = () => j(fetch(`${DAEMON}/actions/chrome/refresh`, { method: "POST" }), null);
export const pickFolder = () =>
  j<{ path?: string; canceled?: boolean }>(fetch(`${DAEMON}/actions/pick-folder`, { method: "POST" }), { canceled: true });
const act = (path: string, projectId: string) =>
  j(fetch(`${DAEMON}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId }) }), null);
export const focusEditor = (id: string) => act("/actions/editor/focus", id);
export const openBrowser = (id: string) => act("/actions/browser/open", id);
export interface ChromeTab { id: string; url: string; title: string; }
export const browserTabs = (projectId: string) =>
  j<{ tabs: ChromeTab[]; url: string | null }>(
    fetch(`${DAEMON}/actions/browser/tabs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId }) }),
    { tabs: [], url: null });
const tabAct = (path: string, tabId: string) =>
  j(fetch(`${DAEMON}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tabId }) }), null);
export const focusTab = (tabId: string) => tabAct("/actions/browser/focus-tab", tabId);
export const closeTab = (tabId: string) => tabAct("/actions/browser/close-tab", tabId);
export const appSettings = () => j(fetch(`${DAEMON}/actions/app/settings`, { method: "POST" }), null);
export const appQuit = () => j(fetch(`${DAEMON}/actions/app/quit`, { method: "POST" }), null);
export const setPopoverSize = (height: number) =>
  j(fetch(`${DAEMON}/actions/app/popover-size`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ height }) }), null);
export const getLoginItem = () => j<{ enabled: boolean; supported?: boolean }>(fetch(`${DAEMON}/actions/app/login-item`), { enabled: false });
export const setLoginItem = (enabled: boolean) =>
  j(fetch(`${DAEMON}/actions/app/login-item`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) }), null);
export const getPermissions = () =>
  j<{ automation: boolean | null; accessibility: boolean | null }>(
    fetch(`${DAEMON}/actions/app/permissions`), { automation: null, accessibility: null });
export const openPrivacy = (pane: "automation" | "accessibility") =>
  j(fetch(`${DAEMON}/actions/app/open-privacy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pane }) }), null);
