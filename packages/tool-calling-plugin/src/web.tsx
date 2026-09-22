import { lazy } from 'react'
import type { WebPlatformPlugin } from '@jojo-claw/core'
import { toolCallingPluginManifest } from './manifest.js'

export const toolCallingWebPlugin: WebPlatformPlugin = {
  manifest: toolCallingPluginManifest,
  register(context) {
    context.registerPage({
      id: 'run', title: 'Tool calling', navLabel: 'Tool calling',
      path: '/plugins/tool-calling', component: lazy(() => import('./ToolCallingPage.js')),
    })
  },
}
