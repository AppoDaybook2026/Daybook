import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: 'Daybook',
      short_name: 'Daybook',
      description: 'A quiet daily workspace.',
      theme_color: '#111210',
      background_color: '#111210',
      display: 'standalone',
      start_url: '/',
    },
    workbox: {
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 3_000_000,
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,mjs}'],
    },
  }), cloudflare()],
})