/// <reference lib="dom" />
import { listProjects, createProject, deleteProject } from "../../bun/api";

const el = (id: string) => document.getElementById(id) as HTMLInputElement;

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
