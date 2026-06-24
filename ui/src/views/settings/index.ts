/// <reference lib="dom" />
import { listProjects, createProject, updateProject, deleteProject, fetchState, pickFolder } from "../../bun/api";

const EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

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
  const views = (await fetchState()).filter((v: any) => v.project.enabled !== false);
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
    const visible = p.enabled !== false;
    const row = document.createElement("div"); row.className = "row" + (visible ? "" : " off");
    row.appendChild(mkdot(headline, "dot"));
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = p.name;
    const code = document.createElement("span"); code.className = "code"; code.textContent = code4(p);
    const path = document.createElement("span"); path.className = "path"; path.textContent = p.path;
    const spacer = document.createElement("span"); spacer.className = "spacer";
    row.append(nm, code, path, spacer);
    if (p.port) { const c = document.createElement("span"); c.className = "chip"; c.textContent = ":" + p.port; row.append(c); }
    const vis = document.createElement("button"); vis.className = "iconbtn";
    vis.innerHTML = visible ? EYE : EYE_OFF;
    vis.title = visible ? "Hide from menu bar" : "Show in menu bar";
    vis.onclick = async () => { await updateProject(p.id, { enabled: !visible }); renderList(); renderStatus(); };
    row.append(vis);
    const edit = document.createElement("button"); edit.className = "remove"; edit.textContent = "Edit";
    edit.onclick = () => startEdit(p);
    const del = document.createElement("button"); del.className = "remove"; del.textContent = "Remove";
    del.onclick = async () => { if (editingId === p.id) resetForm(); await deleteProject(p.id); renderList(); renderStatus(); };
    row.append(edit, del);
    list.appendChild(row);
  }
}

// --- add / edit form ---
let editingId: string | null = null;
let codeEdited = false;

function resetForm() {
  editingId = null;
  codeEdited = false;
  for (const f of ["name", "code", "path", "cmd", "port"]) el(f).value = "";
  byId("formtitle").textContent = "Add a project";
  byId("submit").textContent = "Add project";
  byId("cancel").style.display = "none";
}

function startEdit(p: any) {
  editingId = p.id;
  codeEdited = true;
  el("name").value = p.name ?? "";
  el("code").value = (p.code || p.name || "").toString().replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  el("path").value = p.path ?? "";
  el("cmd").value = p.devCommand ?? "";
  el("port").value = p.port ? String(p.port) : "";
  byId("formtitle").textContent = "Edit project";
  byId("submit").textContent = "Save changes";
  byId("cancel").style.display = "";
  byId("name").scrollIntoView({ behavior: "smooth", block: "center" });
}

byId("cancel").addEventListener("click", () => resetForm());

// auto-fill code from name as you type (unless the user typed a code already)
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
  const fields = {
    name, code, path, devCommand: el("cmd").value.trim() || "pnpm dev",
    port, url: port ? `http://localhost:${port}` : null, enabled: true,
  };
  if (editingId) {
    await updateProject(editingId, fields);
  } else {
    await createProject({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...fields });
  }
  resetForm();
  renderList(); renderStatus();
});

renderList();
renderStatus();
setInterval(() => { renderStatus(); renderList(); }, 1500);
