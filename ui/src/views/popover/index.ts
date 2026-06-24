/// <reference lib="dom" />
import { fetchState, focusEditor, openBrowser, appSettings, appQuit, browserTabs, focusTab, closeTab, type ChromeTab } from "../../bun/api";

const COLOR: Record<string, string> = {
  blocked_permission: "#ff453a", error: "#ff453a", blocked_input: "#ff453a",
  compacting: "#bf5af0", working: "#ffd60a", idle: "#30d158", gone: "#8e8e93",
};
const LABEL: Record<string, string> = {
  blocked_permission: "needs permission", error: "error", blocked_input: "waiting for input",
  compacting: "compacting", working: "working", idle: "idle", gone: "no session",
};
const PRIORITY = ["blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone"];
const code4 = (p: any) => (p.code || p.name).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "····";

// Per-project tab-manager state.
const expanded = new Set<string>();
const tabsCache = new Map<string, ChromeTab[]>();

function dot(status: string, cls = "dot"): HTMLSpanElement {
  const d = document.createElement("span"); d.className = cls;
  d.style.background = COLOR[status] ?? "#8e8e93"; return d;
}

async function refreshTabs(id: string) {
  const r = await browserTabs(id);
  tabsCache.set(id, r.tabs);
  render();
}

function tabsSection(projectId: string): HTMLElement {
  const wrap = document.createElement("div"); wrap.className = "tabs";
  const hdr = document.createElement("div"); hdr.className = "tabhdr"; hdr.textContent = "Browser tabs";
  wrap.appendChild(hdr);
  const tabs = tabsCache.get(projectId) ?? [];
  if (!tabs.length) {
    const none = document.createElement("div"); none.className = "notabs"; none.textContent = "No matching tabs open.";
    wrap.appendChild(none);
  }
  for (const t of tabs) {
    const row = document.createElement("div"); row.className = "tab";
    const u = document.createElement("div"); u.className = "u";
    u.title = t.url;
    const main = document.createElement("div"); main.textContent = t.url;
    const sub = document.createElement("div"); sub.className = "t"; sub.textContent = t.title || "";
    u.append(main, sub);
    u.onclick = () => focusTab(t.id);
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.title = "Close tab";
    x.onclick = async () => { await closeTab(t.id); await refreshTabs(projectId); };
    row.append(u, x);
    wrap.appendChild(row);
  }
  const nt = document.createElement("button"); nt.className = "newtab"; nt.textContent = "＋ Open new tab";
  nt.onclick = async () => { await openBrowser(projectId); await refreshTabs(projectId); };
  wrap.appendChild(nt);
  return wrap;
}

async function render() {
  const views = await fetchState();
  const list = document.getElementById("list")!;
  if (!views.length) { list.innerHTML = '<div class="empty">No projects yet. Open Settings to add one.</div>'; return; }
  const sorted = [...views].sort((a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline));
  list.innerHTML = "";
  for (const v of sorted) {
    const id = v.project.id;
    const card = document.createElement("div"); card.className = "card";

    const top = document.createElement("div"); top.className = "top";
    top.appendChild(dot(v.claude.headline));
    const name = document.createElement("span"); name.className = "name"; name.textContent = v.project.name;
    const code = document.createElement("span"); code.className = "code"; code.textContent = code4(v.project);
    const spacer = document.createElement("span"); spacer.className = "spacer";
    top.append(name, code, spacer);
    if (v.dev?.running && v.dev.port) { const c = document.createElement("span"); c.className = "chip"; c.textContent = ":" + v.dev.port; top.append(c); }
    card.appendChild(top);

    const status = document.createElement("div"); status.className = "status";
    status.textContent = LABEL[v.claude.headline] ?? v.claude.headline;
    if (v.claude.sessions.length) {
      const sd = document.createElement("span"); sd.className = "sessdots";
      for (const s of v.claude.sessions) sd.appendChild(dot(s.status, "sd"));
      status.appendChild(sd);
    }
    card.appendChild(status);

    const actions = document.createElement("div"); actions.className = "actions";
    const edBtn = document.createElement("button"); edBtn.textContent = "Open editor";
    edBtn.onclick = () => focusEditor(id);
    const canBrowse = !!(v.project.url || v.project.port || (v.dev && v.dev.port));
    const brBtn = document.createElement("button"); brBtn.className = "primary";
    brBtn.textContent = expanded.has(id) ? "Hide tabs" : "Open browser";
    brBtn.disabled = !canBrowse;
    if (!canBrowse) brBtn.title = "Set a port for this project to use the browser";
    brBtn.onclick = async () => {
      if (!canBrowse) return;
      if (expanded.has(id)) { expanded.delete(id); render(); return; }
      expanded.add(id);
      await refreshTabs(id); // fetches tabs + re-renders
    };
    actions.append(edBtn, brBtn);
    card.appendChild(actions);

    if (expanded.has(id)) card.appendChild(tabsSection(id));

    list.appendChild(card);
  }
}

document.getElementById("settings")!.addEventListener("click", () => appSettings());
document.getElementById("quit")!.addEventListener("click", () => appQuit());

render();
setInterval(render, 1500);
