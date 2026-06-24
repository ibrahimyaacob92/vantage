import { homedir } from "os";
import { join } from "path";
import { stripHooks } from "./install";

const settingsPath = join(homedir(), ".claude", "settings.json");

if (import.meta.main) {
  const f = Bun.file(settingsPath);
  if (!(await f.exists())) { console.log("No settings.json; nothing to remove."); process.exit(0); }
  const existing = await f.json();
  await Bun.write(settingsPath, JSON.stringify(stripHooks(existing), null, 2));
  console.log(`Removed Vantage hooks from ${settingsPath}.`);
}
