import { lazy } from 'react'
import type { WebPlatformPlugin } from '@jojo-claw/core'
import { textPluginManifest } from './manifest.js'

export const textWebPlugin: WebPlatformPlugin = {
  manifest: textPluginManifest,
  register(context) {
    context.registerPage({
      id: 'generate',
      title: 'New generation',
      navLabel: 'Text generation',
      path: '/plugins/text',
      component: lazy(() => import('./TextGenerationPage.js')),
    })
  },
}
