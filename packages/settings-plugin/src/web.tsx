import { lazy } from "react";
import type { WebPlatformPlugin } from "@jojo-claw/core";
import { settingsPluginManifest } from "./manifest.js";

export const settingsWebPlugin: WebPlatformPlugin = {
  manifest: settingsPluginManifest,
  register(context) {
    context.registerPage({
      id: "manage",
      title: "Plugin settings",
      navLabel: "Settings",
      path: "/plugins/settings",
      component: lazy(() => import("./SettingsPage.js")),
    });
  },
};
