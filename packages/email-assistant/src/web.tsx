import { lazy } from 'react'
import type { WebPlatformPlugin } from '@jojo-claw/core'
import { emailAssistantPluginManifest } from './manifest.js'

export const emailAssistantWebPlugin: WebPlatformPlugin = {
  manifest: emailAssistantPluginManifest,
  register(context) {
    context.registerPage({
      id: 'inbox-evaluation',
      title: 'Inbox evaluation',
      navLabel: 'Email assistant',
      path: '/plugins/email-assistant',
      component: lazy(() => import('./EmailAssistantPage.js')),
    })
  },
}
