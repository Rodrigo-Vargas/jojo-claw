import { lazy } from "react";
import type { WebPlatformPlugin } from "@jojo-claw/core";
import { promptsPluginManifest } from "./manifest.js";

export const promptsWebPlugin: WebPlatformPlugin = {
  manifest: promptsPluginManifest,
  register(context) {
    context.registerPage({
      id: "manage", title: "Prompts", navLabel: "Prompts",
      path: "/plugins/prompts", component: lazy(() => import("./PromptsPage.js")),
    });
  },
};
