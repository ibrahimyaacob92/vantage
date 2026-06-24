/// <reference lib="dom" />
import { listProjects, createProject, deleteProject, fetchState, pickFolder } from "../../bun/api";

const el = (id: string) => document.getElementById(id) as HTMLInputElement;

const DOT: Record<string, string> = {
  blocked_permission: "🔴", error: "🔴", blocked_input: "🔴",
  compacting: "🟣", working: "🟡", idle: "🔵", gone: "⚪",
};
const PRIORITY = ["blocked_permission","error","blocked_input","compacting","working","idle","gone"];

async function renderStatus() {
  const views = await fetchState();
  // bar row (B summary + A per-project)
  const needs = views.filter((v) => v.claude.needsAttention).length;
  const work = views.filter((v) => ["working","compacting"].includes(v.claude.headline)).length;
  const idle = views.filter((v) => ["idle","gone"].includes(v.claude.headline)).length;
  const sorted = [...views].sort((a, b) => PRIORITY.indexOf(a.claude.headline) - PRIORITY.indexOf(b.claude.headline));
  const bar = document.getElementById("bar")!;
  bar.textContent = views.length
    ? `🔴${needs} 🟡${work} 🔵${idle} ┃ ` + sorted.map((v) => DOT[v.claude.headline] + v.project.name).join(" ")
    : "no projects registered yet — add one below";

  const status = document.getElementById("status")!;
  status.innerHTML = "";
  for (const v of sorted) {
    const row = document.createElement("div");
    row.className = "proj";
    const dot = document.createElement("span"); dot.className = "dot"; dot.textContent = DOT[v.claude.headline];
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = v.project.name;
    const det = document.createElement("span"); det.className = "det";
    det.textContent = v.claude.headline + (v.claude.sessions?.[0]?.detail ? " · " + v.claude.sessions[0].detail : "");
    row.append(dot, nm, det);
    if (v.dev?.running && v.dev.port) { const b = document.createElement("span"); b.className = "badge"; b.textContent = ":" + v.dev.port; row.append(b); }
    if (v.browser?.tabOpen) { const b = document.createElement("span"); b.className = "badge"; b.textContent = "tab"; row.append(b); }
    status.appendChild(row);
  }
}

async function render() {
  const projects = await listProjects();
  const list = document.getElementById("list")!;
  list.innerHTML = "";
  for (const p of projects) {
    const div = document.createElement("div");
    div.className = "row";
    const nameEl = document.createElement("b");
    nameEl.textContent = p.name;
    const pathEl = document.createElement("span");
    pathEl.className = "muted";
    pathEl.textContent = p.path;
    div.appendChild(nameEl);
    div.appendChild(document.createTextNode(" "));
    div.appendChild(pathEl);
    div.appendChild(document.createTextNode(` · ${p.devCommand}${p.port ? " · :" + p.port : ""} `));
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = async () => { await deleteProject(p.id); render(); };
    div.appendChild(del);
    list.appendChild(div);
  }
}

document.getElementById("browse")!.addEventListener("click", async () => {
  const res = await pickFolder();
  if (res.path) {
    el("path").value = res.path;
    // Helpfully default the name to the folder's basename if empty.
    if (!el("name").value.trim()) el("name").value = res.path.split("/").filter(Boolean).pop() ?? "";
  }
});

document.getElementById("add")!.addEventListener("click", async () => {
  const name = el("name").value.trim();
  const path = el("path").value.trim();
  if (!name || !path) return;
  const port = el("port").value ? Number(el("port").value) : null;
  await createProject({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name, path, devCommand: el("cmd").value.trim() || "pnpm dev",
    port, url: port ? `http://localhost:${port}` : null, enabled: true,
  });
  for (const f of ["name","path","cmd","port"]) el(f).value = "";
  render();
});

render();
renderStatus();
setInterval(renderStatus, 1000);
