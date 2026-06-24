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
// IMPORTANT: we HIDE rather than close it. Electrobun quits the app when its
// last window closes, so a persistent (hidden) window keeps the tray alive.
let popoverWin: BrowserWindow | null = null;
let popoverVisible = false;
function ensurePopover() {
  if (popoverWin) return;
  let x = 320, y = 28;
  try { const b = tray.getBounds(); if (b && b.x) x = Math.max(8, Math.round(b.x) - 170); } catch {}
  popoverWin = new BrowserWindow({
    title: "projflow",
    url: "views://popover/index.html",
    frame: { width: 340, height: 440, x, y },
  });
  popoverWin.hide();
  popoverVisible = false;
}
function togglePopover() {
  ensurePopover();
  if (popoverVisible) { popoverWin!.hide(); popoverVisible = false; return; }
  void refreshChrome();
  popoverWin!.show();
  popoverWin!.focus();
  popoverVisible = true;
}

setAppActions({
  openSettings: () => { if (popoverVisible && popoverWin) { popoverWin.hide(); popoverVisible = false; } openDashboard(); },
  quit: () => process.exit(0),
});

ensurePopover(); // keep a (hidden) window alive so closing things never quits the app
tray.on("tray-clicked", () => { togglePopover(); });
try { app.on("reopen", () => togglePopover()); } catch {}

await updateBar();
setInterval(updateBar, 1000);
