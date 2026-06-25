// Mark the app as a menu-bar agent (LSUIElement) so it has no Dock icon and
// doesn't appear in ⌘-Tab — it lives only in the menu bar.
// Used as Electrobun's postWrap hook (gets ELECTROBUN_WRAPPER_BUNDLE_PATH),
// and runnable directly: `bun scripts/set-agent.ts <path-to.app>`.
import { existsSync } from "fs";

const bundle = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH || process.argv[2];
if (!bundle) { console.log("set-agent: no bundle path; skipping"); process.exit(0); }

const plist = [`${bundle}/Contents/Info.plist`, `${bundle}/Info.plist`].find(existsSync);
if (!plist) { console.log("set-agent: no Info.plist under", bundle); process.exit(0); }

const PB = "/usr/libexec/PlistBuddy";
const added = Bun.spawnSync([PB, "-c", "Add :LSUIElement bool true", plist]);
if (added.exitCode !== 0) Bun.spawnSync([PB, "-c", "Set :LSUIElement true", plist]);
console.log("set-agent: LSUIElement=true on", plist);
