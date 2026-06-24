import { mkdir } from "fs/promises";
import { dirname } from "path";
import type { Project } from "./types";

export class Registry {
  private projects = new Map<string, Project>();
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    const f = Bun.file(this.filePath);
    if (await f.exists()) {
      const arr = (await f.json()) as Project[];
      this.projects = new Map(arr.map((p) => [p.id, p]));
    }
  }

  list(): Project[] { return [...this.projects.values()]; }
  get(id: string): Project | undefined { return this.projects.get(id); }

  async add(p: Project): Promise<void> { this.projects.set(p.id, p); await this.save(); }

  async update(id: string, patch: Partial<Project>): Promise<Project> {
    const cur = this.projects.get(id);
    if (!cur) throw new Error(`no project ${id}`);
    const next = { ...cur, ...patch, id: cur.id };
    this.projects.set(id, next);
    await this.save();
    return next;
  }

  async remove(id: string): Promise<void> { this.projects.delete(id); await this.save(); }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await Bun.write(this.filePath, JSON.stringify(this.list(), null, 2));
  }
}
