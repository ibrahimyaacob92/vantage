import { test, expect } from "bun:test";
import { headline, isNeedsAttention, buildProjectViews } from "../src/derive";
import type { Project, Session } from "../src/types";
import { DetectionStore } from "../src/detection";

const proj = (id: string): Project => ({
  id, name: id, path: `/dev/${id}`, devCommand: "pnpm dev", port: null, url: null, enabled: true,
});
const sess = (id: string, projectId: string | null, status: Session["status"]): Session => ({
  sessionId: id, cwd: "/dev/web", projectId, status, detail: null, pid: 1, subagents: 0,
  model: null, tokens: null, contextPct: null, transcriptPath: null, lastEventAt: 0, lastEvent: "x",
});

test("headline picks highest priority", () => {
  expect(headline(["idle", "working", "error"])).toBe("error");
  expect(headline(["working", "blocked_permission"])).toBe("blocked_permission");
  expect(headline(["idle"])).toBe("idle");
  expect(headline([])).toBe("gone");
});

test("needsAttention only for blocked/error", () => {
  expect(isNeedsAttention("blocked_permission")).toBe(true);
  expect(isNeedsAttention("error")).toBe(true);
  expect(isNeedsAttention("blocked_input")).toBe(true);
  expect(isNeedsAttention("working")).toBe(false);
  expect(isNeedsAttention("idle")).toBe(false);
});

test("buildProjectViews groups sessions per project and sets headline", () => {
  const views = buildProjectViews(
    [proj("web"), proj("api")],
    [sess("s1", "web", "working"), sess("s2", "web", "blocked_permission"), sess("s3", "api", "idle")],
  );
  const web = views.find((v) => v.project.id === "web")!;
  expect(web.claude.count).toBe(2);
  expect(web.claude.headline).toBe("blocked_permission");
  expect(web.claude.needsAttention).toBe(true);
  const api = views.find((v) => v.project.id === "api")!;
  expect(api.claude.headline).toBe("idle");
  expect(api.claude.needsAttention).toBe(false);
});

test("project with no sessions has count 0 and headline gone", () => {
  const views = buildProjectViews([proj("web")], []);
  expect(views[0].claude.count).toBe(0);
  expect(views[0].claude.headline).toBe("gone");
});

test("buildProjectViews fills dev/browser from detection store", () => {
  const detection = new DetectionStore();
  detection.setDev("web", { running: true, port: 3000, pid: 5, managed: false });
  detection.setBrowser("web", { tabOpen: true, ref: { windowIndex: 1, tabIndex: 1 } });
  const views = buildProjectViews([proj("web")], [], detection);
  expect(views[0].dev).toEqual({ running: true, port: 3000, pid: 5, managed: false });
  expect(views[0].browser).toEqual({ tabOpen: true, ref: { windowIndex: 1, tabIndex: 1 } });
});
