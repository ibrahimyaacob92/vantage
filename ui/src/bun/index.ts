import { Tray, BrowserWindow, app } from "electrobun/bun";
import { fetchState, refreshChrome } from "./api";
import { formatBarTitle, buildTrayMenu } from "./format";
import { startDaemon } from "../../../daemon/src/index";

// Run projflow as a single program: start the daemon in-process. If a daemon is
// already running on the port, startDaemon() returns false and we use it over
// HTTP. Never let a daemon hiccup stop the UI from coming up.
try { await startDaemon(); } catch (e) { console.error("projflow: daemon start failed", e); }

let latest = await fetchState();
// An icon anchors the menu-bar item so it always has presence; the title carries
// the live status row.
const tray = new Tray({ title: formatBarTitle(latest), image: "views://assets/tray.png", template: true });

let dashboardWin: BrowserWindow | null = null;
function openDashboard() {
  if (dashboardWin) { dashboardWin.focus(); return; }
  dashboardWin = new BrowserWindow({
    title: "projflow",
    url: "views://settings/index.html",
    frame: { width: 540, height: 560, x: 200, y: 120 },
  });
  dashboardWin.on("close", () => { dashboardWin = null; });
}

// Open the dashboard once on launch so projflow is visible even when a menu-bar
// manager hides the tray icon. Also reopen it when the dock icon is clicked.
openDashboard();
try { app.on("reopen", () => openDashboard()); } catch {}

tray.on("tray-clicked", async (e: any) => {
  const action = e?.action ?? e?.data?.action ?? "";
  if (action === "") {
    await refreshChrome();
    latest = await fetchState();
    tray.setMenu(buildTrayMenu(latest) as any);
    return;
  }
  if (action === "settings") openDashboard();
  else if (action === "quit") process.exit(0);
});

setInterval(async () => {
  latest = await fetchState();
  tray.setTitle(formatBarTitle(latest));
}, 1000);
