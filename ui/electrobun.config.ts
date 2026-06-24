import type { ElectrobunConfig } from "electrobun/bun";

const config: ElectrobunConfig = {
  app: { name: "projflow", identifier: "sh.projflow.app", version: "0.1.0" },
  build: {
    bun: { entrypoint: "src/bun/index.ts" },
    views: { settings: { entrypoint: "src/views/settings/index.ts" } },
    copy: {
      "src/views/settings/index.html": "views/settings/index.html",
      "src/views/assets/tray.png": "views/assets/tray.png",
    },
  },
};

export default config;
