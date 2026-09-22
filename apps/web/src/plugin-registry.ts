import type { PluginPage, WebPlatformPlugin } from "@jojo-claw/core";

/** Mounts explicitly imported browser plugins and rejects ambiguous page ownership. */
export function mountWebPlugins(plugins: WebPlatformPlugin[]): PluginPage[] {
  const pages = new Map<string, PluginPage>();
  const pageIds = new Set<string>();
  for (const plugin of plugins)
    plugin.register({
      registerPage: (page) => {
        const prefix = `/plugins/${plugin.manifest.id}`;
        if (!page.id)
          throw new Error(
            `Plugin page for ${plugin.manifest.id} must have an id.`,
          );
        if (page.path !== prefix && !page.path.startsWith(`${prefix}/`))
          throw new Error(
            `Plugin page for ${plugin.manifest.id} must be under '${prefix}'.`,
          );
        if (pageIds.has(`${plugin.manifest.id}:${page.id}`))
          throw new Error(
            `Duplicate plugin page id: ${plugin.manifest.id}:${page.id}`,
          );
        if (pages.has(page.path))
          throw new Error(`Duplicate plugin page: ${page.path}`);
        pages.set(page.path, page);
        pageIds.add(`${plugin.manifest.id}:${page.id}`);
      },
    });
  return [...pages.values()];
}
