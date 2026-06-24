import { Tray, BrowserWindow, app } from "electrobun/bun";
import { fetchState, refreshChrome } from "./api";
import { renderBar } from "./barimage";
import { startDaemon, setAppActions } from "../../../daemon/src/index";

// Run Vantage as a single program: start the daemon in-process.
try { await startDaemon(); } catch (e) { console.error("Vantage: daemon start failed", e); }

// macOS draws menu-bar glyphs white whenever the bar is dark (Dark mode, or a
// dark wallpaper in Light mode) — the common case. Default to white glyphs.
const dark = true;

let latest = await fetchState();
const first = await renderBar(latest, dark);
const tray = new Tray(
  first ? { image: first.pngPath, template: false, width: first.width, height: 22 } : { title: "Vantage" },
);

let lastSig = "";
async function updateBar() {
  latest = await fetchState();
  const sig = JSON.stringify(latest.map((v) => [v.project.id, (v.project as any).code, v.claude.headline, v.claude.sessions.map((s) => s.status)]));
  if (sig === lastSig) return;
  lastSig = sig;
  const r = await renderBar(latest, dark);
  if (r) { tray.setImage(r.pngPath); }
}

// Full dashboard / settings window (project CRUD).
let dashboardWin: BrowserWindow | null = null;
function openDashboard() {
  if (dashboardWin) { dashboardWin.focus(); return; }
  dashboardWin = new BrowserWindow({
    title: "Vantage · Settings",
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
    title: "Vantage",
    url: "views://popover/index.html",
    frame: { width: 340, height: 440, x, y },
    titleBarStyle: "hidden",   // borderless: no title bar, no close button to accidentally kill the app
    transparent: true,         // so the rounded panel corners show (desktop behind)
    hidden: true,              // start hidden (no flash); toggled by the tray
  } as any);
  popoverVisible = false;
}
const POPOVER_W = 340;
function positionPopover() {
  // Anchor the popover near the tray item, just below the menu bar. tray bounds
  // share the window's horizontal origin; y is a small fixed offset (the bar).
  try {
    const b = tray.getBounds();
    if (b && typeof b.x === "number" && b.x > 0) {
      const right = b.x + (b.width || 0);
      const x = Math.max(8, Math.round(right - POPOVER_W));
      popoverWin!.setPosition(x, 26);
      return;
    }
  } catch {}
  popoverWin!.setPosition(200, 26);
}
function togglePopover() {
  ensurePopover();
  if (popoverVisible) { popoverWin!.hide(); popoverVisible = false; return; }
  void refreshChrome();
  positionPopover();
  popoverWin!.show();
  popoverWin!.focus();
  popoverVisible = true;
}

// Backstop: veto any quit the user didn't explicitly ask for (e.g. ⌘Q, a
// window closing). Only our Quit button flips `quitting` then hard-exits.
let quitting = false;
try { app.on("before-quit", () => ({ allow: quitting })); } catch {}

// A brief white border drawn over the window that was just opened/focused.
let overlayWin: BrowserWindow | null = null;
let overlayTimer: ReturnType<typeof setTimeout> | null = null;
function flashOverlay(b: { x: number; y: number; w: number; h: number } | null) {
  if (!b || b.w < 20 || b.h < 20) return;
  try { overlayWin?.close(); } catch {}
  if (overlayTimer) clearTimeout(overlayTimer);
  overlayWin = new BrowserWindow({
    title: "Vantage-flash",
    url: "views://overlay/index.html",
    frame: { width: Math.round(b.w), height: Math.round(b.h), x: Math.round(b.x), y: Math.round(b.y) },
    titleBarStyle: "hidden", transparent: true, passthrough: true, activate: false,
  } as any);
  overlayTimer = setTimeout(() => { try { overlayWin?.close(); } catch {} overlayWin = null; }, 1050);
}

function resizePopover(h: number) {
  if (!popoverWin) return;
  const clamped = Math.max(70, Math.min(Math.round(h), 760));
  try { popoverWin.setSize(POPOVER_W, clamped); } catch {}
}

setAppActions({
  openSettings: () => { if (popoverVisible && popoverWin) { popoverWin.hide(); popoverVisible = false; } openDashboard(); },
  quit: () => { quitting = true; process.exit(0); },
  flash: flashOverlay,
  resizePopover,
});

ensurePopover(); // keep a (hidden) window alive so closing things never quits the app
tray.on("tray-clicked", () => { togglePopover(); });
try { app.on("reopen", () => togglePopover()); } catch {}

await updateBar();
setInterval(updateBar, 1000);
