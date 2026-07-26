import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'Daybook',
        short_name: 'Daybook',
        description: 'A quiet daily workspace.',
        theme_color: '#111210',
        background_color: '#111210',
        display: 'standalone',
        start_url: '/',
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 3_000_000,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,mjs}'],
      },
    }),
  ],
})
