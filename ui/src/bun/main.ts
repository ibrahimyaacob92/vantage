import { Tray, BrowserWindow } from "electrobun/bun";
import { fetchState, refreshChrome } from "./api";
import { formatBarTitle, buildTrayMenu } from "./format";

let latest = await fetchState();
const tray = new Tray({ title: formatBarTitle(latest) });

let settingsWin: BrowserWindow | null = null;
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    title: "projflow · Settings",
    url: "views://settings/index.html",
    frame: { width: 520, height: 460, x: 200, y: 200 },
  });
  settingsWin.on("close", () => { settingsWin = null; });
}

tray.on("tray-clicked", async (e: any) => {
  const action = e?.action ?? e?.data?.action ?? "";
  if (action === "") {
    await refreshChrome();
    latest = await fetchState();
    tray.setMenu(buildTrayMenu(latest) as any);
    return;
  }
  if (action === "settings") openSettings();
  else if (action === "quit") process.exit(0);
});

setInterval(async () => {
  latest = await fetchState();
  tray.setTitle(formatBarTitle(latest));
}, 1000);
