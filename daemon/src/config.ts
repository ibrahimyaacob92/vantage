import { homedir } from "os";
import { join } from "path";

const supportDir = join(homedir(), "Library", "Application Support");
const defaultDataDir = join(supportDir, "Vantage");
/** Old projflow location — migrated on first run so users keep their projects. */
export const legacyDataDir = join(supportDir, "projflow");
const dataDir = process.env.VANTAGE_DATA_DIR ?? process.env.PROJFLOW_DATA_DIR ?? defaultDataDir;

export const config = {
  port: Number(process.env.VANTAGE_PORT ?? process.env.PROJFLOW_PORT ?? 7777),
  dataDir,
  projectsFile: join(dataDir, "projects.json"),
  sessionsFile: join(dataDir, "sessions.json"),
  logsDir: join(dataDir, "logs"),
};
