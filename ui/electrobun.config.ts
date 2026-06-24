import type { ElectrobunConfig } from "electrobun/bun";

// Signed/notarized DMG only when RELEASE=1 (keeps normal dev builds fast/unsigned).
const RELEASE = process.env.RELEASE === "1";

const config: ElectrobunConfig = {
  app: { name: "projflow", identifier: "sh.projflow.app", version: "0.1.0" },
  build: {
    bun: { entrypoint: "src/bun/index.ts" },
    views: {
      settings: { entrypoint: "src/views/settings/index.ts" },
      popover: { entrypoint: "src/views/popover/index.ts" },
    },
    copy: {
      "src/views/settings/index.html": "views/settings/index.html",
      "src/views/popover/index.html": "views/popover/index.html",
      "src/views/overlay/index.html": "views/overlay/index.html",
      "native/barrender": "bin/barrender",
    },
    mac: {
      codesign: RELEASE || process.env.SIGN === "1", // SIGN=1 to test signing without notarizing
      notarize: RELEASE,
      createDmg: RELEASE,
      icons: "icon.iconset",
    },
  },
};

export default config;
