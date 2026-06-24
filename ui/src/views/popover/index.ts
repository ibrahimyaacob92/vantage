/// <reference lib="dom" />
import { fetchState, focusEditor, openBrowser, appSettings, appQuit, browserTabs, focusTab, closeTab, setPopoverSize, type ChromeTab } from "../../bun/api";

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
const hasBrowser = (v: any) => !!(v.project.url || v.project.port || (v.dev && v.dev.port));
const pathOf = (url: string) => { const p = url.replace(/^https?:\/\/[^/]+/, ""); return p || "/"; };

let views: any[] = [];
const tabsCache = new Map<string, ChromeTab[]>();

function dot(status: string, cls = "dot"): HTMLSpanElement {
  const d = document.createElement("span"); d.className = cls;
  d.style.background = COLOR[status] ?? "#8e8e93"; return d;
}

// --- height: measure inner content, tell host to resize (no scrollbar) ---
let lastH = 0;
function reportSize() {
  requestAnimationFrame(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const h = Math.ceil(root.getBoundingClientRect().height) + 20 + 6; // body padding + buffer
    if (h > 0 && Math.abs(h - lastH) > 1) { lastH = h; setPopoverSize(h); }
  });
}

function tabsSection(projectId: string): HTMLElement {
  const wrap = document.createElement("div"); wrap.className = "tabs";
  const tabs = tabsCache.get(projectId) ?? [];
  for (const t of tabs) {
    const row = document.createElement("div"); row.className = "tab";
    const u = document.createElement("div"); u.className = "u"; u.title = t.url;
    u.textContent = pathOf(t.url);
    u.onclick = () => focusTab(t.id);
    const x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.title = "Close tab";
    x.onclick = async () => { await closeTab(t.id); await refreshTabs(projectId); };
    row.append(u, x);
    wrap.appendChild(row);
  }
  if (!tabs.length) { const none = document.createElement("div"); none.className = "notabs"; none.textContent = "No tabs open — use +port to open one."; wrap.appendChild(none); }
  return wrap;
}

function render() {
  const list = document.getElementById("list")!;
  const visible = views.filter((v) => v.project.enabled !== false);
  if (!visible.length) { list.innerHTML = '<div class="empty">No visible projects. Open Settings to add or show one.</div>'; reportSize(); return; }
  const sorted = [...visible].sort((a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline));
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
    const port = v.dev?.port || (v.project as any).port;
    if (port) {
      const pb = document.createElement("button"); pb.className = "portbtn";
      pb.textContent = "+" + port; pb.title = "Open a new tab in the browser";
      pb.onclick = async () => { await openBrowser(id); await refreshTabs(id); };
      top.append(pb);
    }
    const edBtn = document.createElement("button"); edBtn.className = "iconbtn"; edBtn.title = "Open in editor";
    edBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
    edBtn.onclick = () => focusEditor(id);
    top.append(edBtn);
    card.appendChild(top);

    const status = document.createElement("div"); status.className = "status";
    status.textContent = LABEL[v.claude.headline] ?? v.claude.headline;
    if (v.claude.sessions.length) {
      const sd = document.createElement("span"); sd.className = "sessdots";
      for (const s of v.claude.sessions) sd.appendChild(dot(s.status, "sd"));
      status.appendChild(sd);
    }
    card.appendChild(status);

    if (hasBrowser(v)) card.appendChild(tabsSection(id));

    list.appendChild(card);
  }
  reportSize();
}

async function refreshTabs(id: string) {
  const r = await browserTabs(id);
  tabsCache.set(id, r.tabs);
  render();
}

let ticking = false;
async function tick() {
  if (ticking) return; // skip if the previous tick (slow AppleScript) is still running
  ticking = true;
  try {
    views = await fetchState();
    await Promise.all(views.filter((v) => v.project.enabled !== false && hasBrowser(v)).map(async (v) => {
      const r = await browserTabs(v.project.id);
      tabsCache.set(v.project.id, r.tabs);
    }));
    render();
  } finally { ticking = false; }
}

document.getElementById("settings")!.addEventListener("click", () => appSettings());
document.getElementById("quit")!.addEventListener("click", () => appQuit());

tick();
setInterval(tick, 2000);
