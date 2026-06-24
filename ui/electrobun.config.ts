import { defineConfig } from "electrobun";

export default defineConfig({
  app: { name: "projflow", identifier: "sh.projflow.app", version: "0.1.0" },
  build: {
    bun: { entrypoint: "src/bun/main.ts" },
    views: { settings: { entrypoint: "src/views/settings/index.ts" } },
    copy: { "src/views/settings/index.html": "views/settings/index.html" },
  },
});
