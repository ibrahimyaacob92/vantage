/// <reference lib="dom" />
import { fetchState, focusEditor, openBrowser, appSettings, appQuit } from "../../bun/api";

const COLOR: Record<string, string> = {
  blocked_permission: "#ff453a", error: "#ff453a", blocked_input: "#ff453a",
  compacting: "#bf5af0", working: "#ffd60a", idle: "#0a84ff", gone: "#8e8e93",
};
const LABEL: Record<string, string> = {
  blocked_permission: "needs permission", error: "error", blocked_input: "waiting for input",
  compacting: "compacting", working: "working", idle: "idle", gone: "no session",
};
const PRIORITY = ["blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone"];
const code4 = (p: any) => (p.code || p.name).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "····";

function dot(status: string, cls = "dot"): HTMLSpanElement {
  const d = document.createElement("span"); d.className = cls;
  d.style.background = COLOR[status] ?? "#8e8e93"; return d;
}

async function render() {
  const views = await fetchState();
  const list = document.getElementById("list")!;
  if (!views.length) { list.innerHTML = '<div class="empty">No projects yet. Open Settings to add one.</div>'; return; }
  const sorted = [...views].sort((a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline));
  list.innerHTML = "";
  for (const v of sorted) {
    const card = document.createElement("div"); card.className = "card";

    const top = document.createElement("div"); top.className = "top";
    top.appendChild(dot(v.claude.headline));
    const name = document.createElement("span"); name.className = "name"; name.textContent = v.project.name;
    const code = document.createElement("span"); code.className = "code"; code.textContent = code4(v.project);
    const spacer = document.createElement("span"); spacer.className = "spacer";
    top.append(name, code, spacer);
    if (v.dev?.running && v.dev.port) { const c = document.createElement("span"); c.className = "chip"; c.textContent = ":" + v.dev.port; top.append(c); }
    if (v.browser?.tabOpen) { const c = document.createElement("span"); c.className = "chip"; c.textContent = "tab"; top.append(c); }
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
    edBtn.onclick = () => focusEditor(v.project.id);
    const brBtn = document.createElement("button"); brBtn.className = "primary"; brBtn.textContent = "Open browser";
    const canBrowse = !!(v.project.url || v.project.port || (v.dev && v.dev.port));
    brBtn.disabled = !canBrowse;
    brBtn.onclick = () => openBrowser(v.project.id);
    actions.append(edBtn, brBtn);
    card.appendChild(actions);

    list.appendChild(card);
  }
}

document.getElementById("settings")!.addEventListener("click", () => appSettings());
document.getElementById("quit")!.addEventListener("click", () => appQuit());

render();
setInterval(render, 1000);
