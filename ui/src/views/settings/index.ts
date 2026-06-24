/// <reference lib="dom" />
import { listProjects, createProject, deleteProject, fetchState, pickFolder } from "../../bun/api";

const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const byId = (id: string) => document.getElementById(id)!;

const COLOR: Record<string, string> = {
  blocked_permission: "#ff453a", error: "#ff453a", blocked_input: "#ff453a",
  compacting: "#bf5af0", working: "#ffd60a", idle: "#30d158", gone: "#8e8e93",
};
const LABEL: Record<string, string> = {
  blocked_permission: "needs permission", error: "error", blocked_input: "waiting for input",
  compacting: "compacting", working: "working", idle: "idle", gone: "no session",
};
const PRIORITY = ["blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone"];
const code4 = (p: any) => ((p.code || p.name) as string).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "····";
const mkdot = (status: string, size: string) => {
  const d = document.createElement("span"); d.className = size;
  d.style.background = COLOR[status] ?? "#8e8e93"; return d;
};

async function renderStatus() {
  const views = await fetchState();
  const sorted = [...views].sort((a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline));

  // menu-bar preview (mirrors the real tile: code over colored session dots)
  const preview = byId("preview");
  if (!sorted.length) { preview.innerHTML = '<span class="none">no projects — add one below</span>'; }
  else {
    preview.innerHTML = "";
    for (const v of sorted) {
      const tile = document.createElement("div"); tile.className = "ptile";
      const pc = document.createElement("span"); pc.className = "pc"; pc.textContent = code4(v.project);
      const pd = document.createElement("div"); pd.className = "pd";
      const sessions = v.claude.sessions.length ? v.claude.sessions : [{ status: v.claude.headline } as any];
      for (const s of sessions) { const dd = mkdot(s.status, "pdot"); pd.appendChild(dd); }
      tile.append(pc, pd); preview.appendChild(tile);
    }
  }
  return sorted;
}

async function renderList() {
  const [projects, views] = [await listProjects(), await fetchState()];
  const statusByPath = new Map(views.map((v: any) => [v.project.id, v]));
  const list = byId("list");
  if (!projects.length) { list.innerHTML = '<div class="empty">No projects yet — add one below.</div>'; return; }
  list.innerHTML = "";
  for (const p of projects) {
    const v: any = statusByPath.get(p.id);
    const headline = v?.claude?.headline ?? "gone";
    const row = document.createElement("div"); row.className = "row";
    row.appendChild(mkdot(headline, "dot"));
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = p.name;
    const code = document.createElement("span"); code.className = "code"; code.textContent = code4(p);
    const path = document.createElement("span"); path.className = "path"; path.textContent = p.path;
    const spacer = document.createElement("span"); spacer.className = "spacer";
    row.append(nm, code, path, spacer);
    if (p.port) { const c = document.createElement("span"); c.className = "chip"; c.textContent = ":" + p.port; row.append(c); }
    const del = document.createElement("button"); del.className = "remove"; del.textContent = "Remove";
    del.onclick = async () => { await deleteProject(p.id); renderList(); renderStatus(); };
    row.append(del);
    list.appendChild(row);
  }
}

// auto-fill code from name as you type (unless the user typed a code already)
let codeEdited = false;
byId("code").addEventListener("input", () => { codeEdited = true; });
byId("name").addEventListener("input", () => {
  if (!codeEdited) el("code").value = el("name").value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
});

byId("browse").addEventListener("click", async () => {
  const res = await pickFolder();
  if (res.path) {
    el("path").value = res.path;
    if (!el("name").value.trim()) {
      el("name").value = res.path.split("/").filter(Boolean).pop() ?? "";
      if (!codeEdited) el("code").value = el("name").value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
    }
  }
});

byId("addform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el("name").value.trim();
  const path = el("path").value.trim();
  if (!name || !path) return;
  const port = el("port").value ? Number(el("port").value) : null;
  const code = (el("code").value.trim() || name).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  await createProject({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name, code, path, devCommand: el("cmd").value.trim() || "pnpm dev",
    port, url: port ? `http://localhost:${port}` : null, enabled: true,
  });
  for (const f of ["name", "code", "path", "cmd", "port"]) el(f).value = "";
  codeEdited = false;
  renderList(); renderStatus();
});

renderList();
renderStatus();
setInterval(() => { renderStatus(); renderList(); }, 1500);
