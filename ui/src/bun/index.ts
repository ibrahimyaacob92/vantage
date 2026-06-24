import { Tray, BrowserWindow, app } from "electrobun/bun";
import { fetchState, refreshChrome } from "./api";
import { buildBarSvg, renderBarPng } from "./barimage";
import { startDaemon, setAppActions } from "../../../daemon/src/index";

// Run projflow as a single program: start the daemon in-process.
try { await startDaemon(); } catch (e) { console.error("projflow: daemon start failed", e); }

// macOS draws menu-bar glyphs white whenever the bar is dark (Dark mode, or a
// dark wallpaper in Light mode) — the common case. Default to white glyphs.
const dark = true;

let latest = await fetchState();
const firstPng = await renderBarPng(latest, dark);
const { width: firstW } = buildBarSvg(latest, dark);
const tray = new Tray(
  firstPng ? { image: firstPng, template: false, width: firstW, height: 22 } : { title: "projflow" },
);

let lastSig = "";
async function updateBar() {
  latest = await fetchState();
  const sig = JSON.stringify(latest.map((v) => [v.project.id, (v.project as any).code, v.claude.headline, v.claude.sessions.map((s) => s.status)]));
  if (sig === lastSig) return;
  lastSig = sig;
  const png = await renderBarPng(latest, dark);
  if (png) tray.setImage(png);
}

// Full dashboard / settings window (project CRUD).
let dashboardWin: BrowserWindow | null = null;
function openDashboard() {
  if (dashboardWin) { dashboardWin.focus(); return; }
  dashboardWin = new BrowserWindow({
    title: "projflow · Settings",
    url: "views://settings/index.html",
    frame: { width: 540, height: 560, x: 220, y: 120 },
  });
  dashboardWin.on("close", () => { dashboardWin = null; });
}

// Custom popover (replaces the native menu): per-project status + actions.
let popoverWin: BrowserWindow | null = null;
async function togglePopover() {
  if (popoverWin) { popoverWin.close(); popoverWin = null; return; }
  void refreshChrome();
  let x = 320, y = 28;
  try { const b = tray.getBounds(); if (b && b.x) x = Math.max(8, Math.round(b.x) - 160); } catch {}
  popoverWin = new BrowserWindow({
    title: "projflow",
    url: "views://popover/index.html",
    frame: { width: 340, height: 440, x, y },
  });
  popoverWin.on("close", () => { popoverWin = null; });
}

setAppActions({
  openSettings: () => { if (popoverWin) { popoverWin.close(); popoverWin = null; } openDashboard(); },
  quit: () => process.exit(0),
});

tray.on("tray-clicked", () => { void togglePopover(); });
try { app.on("reopen", () => togglePopover()); } catch {}

await updateBar();
setInterval(updateBar, 1000);
