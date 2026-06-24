/// <reference lib="dom" />
import { listProjects, createProject, deleteProject, fetchState, pickFolder } from "../../bun/api";

const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const byId = (id: string) => document.getElementById(id)!;

const DOT: Record<string, string> = {
  blocked_permission: "🔴", error: "🔴", blocked_input: "🔴",
  compacting: "🟣", working: "🟡", idle: "🟢", gone: "⚪",
};
const PRIORITY = ["blocked_permission", "error", "blocked_input", "compacting", "working", "idle", "gone"];
const LABEL: Record<string, string> = {
  blocked_permission: "needs permission", error: "error", blocked_input: "waiting for input",
  compacting: "compacting", working: "working", idle: "idle", gone: "no session",
};

async function renderStatus() {
  const views = await fetchState();
  const needs = views.filter((v) => v.claude.needsAttention).length;
  const work = views.filter((v) => ["working", "compacting"].includes(v.claude.headline)).length;
  const idle = views.filter((v) => ["idle", "gone"].includes(v.claude.headline)).length;
  const sorted = [...views].sort((a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline));

  byId("bar").textContent = views.length
    ? `🔴${needs} 🟡${work} 🔵${idle} ┃ ` + sorted.map((v) => DOT[v.claude.headline] + v.project.name).join(" ")
    : "no projects yet";

  const status = byId("status");
  if (!views.length) { status.innerHTML = '<div class="empty">add a project below to start tracking it</div>'; return; }
  status.innerHTML = "";
  for (const v of sorted) {
    const row = document.createElement("div");
    row.className = "proj";
    const dot = document.createElement("span"); dot.className = "dot"; dot.textContent = DOT[v.claude.headline];
    const nm = document.createElement("span"); nm.className = "pname"; nm.textContent = v.project.name;
    const det = document.createElement("span"); det.className = "pdet";
    const sessDetail = v.claude.sessions?.[0]?.detail;
    det.textContent = LABEL[v.claude.headline] + (sessDetail ? " · " + sessDetail : "");
    const spacer = document.createElement("span"); spacer.className = "spacer";
    row.append(dot, nm, det, spacer);
    if (v.dev?.running && v.dev.port) { const b = document.createElement("span"); b.className = "chip"; b.textContent = ":" + v.dev.port; row.append(b); }
    if (v.browser?.tabOpen) { const b = document.createElement("span"); b.className = "chip"; b.textContent = "tab"; row.append(b); }
    status.appendChild(row);
  }
}

async function renderList() {
  const projects = await listProjects();
  const list = byId("list");
  if (!projects.length) { list.innerHTML = '<div class="empty">no projects yet</div>'; return; }
  list.innerHTML = "";
  for (const p of projects) {
    const row = document.createElement("div");
    row.className = "proj";
    const nm = document.createElement("span"); nm.className = "pname"; nm.textContent = p.name;
    const det = document.createElement("span"); det.className = "pdet"; det.textContent = p.path;
    const spacer = document.createElement("span"); spacer.className = "spacer";
    row.append(nm, det, spacer);
    if (p.port) { const b = document.createElement("span"); b.className = "chip"; b.textContent = ":" + p.port; row.append(b); }
    const del = document.createElement("button"); del.className = "del"; del.textContent = "Remove";
    del.onclick = async () => { await deleteProject(p.id); renderList(); renderStatus(); };
    row.append(del);
    list.appendChild(row);
  }
}

byId("browse").addEventListener("click", async () => {
  const res = await pickFolder();
  if (res.path) {
    el("path").value = res.path;
    if (!el("name").value.trim()) el("name").value = res.path.split("/").filter(Boolean).pop() ?? "";
  }
});

byId("addform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = el("name").value.trim();
  const path = el("path").value.trim();
  if (!name || !path) return;
  const port = el("port").value ? Number(el("port").value) : null;
  await createProject({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name, path, devCommand: el("cmd").value.trim() || "pnpm dev",
    port, url: port ? `http://localhost:${port}` : null, enabled: true,
  });
  for (const f of ["name", "path", "cmd", "port"]) el(f).value = "";
  renderList(); renderStatus();
});

renderList();
renderStatus();
setInterval(renderStatus, 1000);
