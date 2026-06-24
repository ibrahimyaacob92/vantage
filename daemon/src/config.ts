import { homedir } from "os";
import { join } from "path";

const defaultDataDir = join(homedir(), "Library", "Application Support", "projflow");
const dataDir = process.env.PROJFLOW_DATA_DIR ?? defaultDataDir;

export const config = {
  port: Number(process.env.PROJFLOW_PORT ?? 7777),
  dataDir,
  projectsFile: join(dataDir, "projects.json"),
  sessionsFile: join(dataDir, "sessions.json"),
  logsDir: join(dataDir, "logs"),
};
