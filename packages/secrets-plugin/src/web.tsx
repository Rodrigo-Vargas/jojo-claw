import { lazy } from 'react'
import type { WebPlatformPlugin } from '@jojo-claw/core'
import { secretsPluginManifest } from './manifest.js'

export const secretsWebPlugin: WebPlatformPlugin = {
  manifest: secretsPluginManifest,
  register(context) {
    context.registerPage({
      id: 'manage',
      title: 'Manage secrets',
      navLabel: 'Secrets',
      path: '/plugins/secrets',
      component: lazy(() => import('./SecretsPage.js')),
    })
  },
}
