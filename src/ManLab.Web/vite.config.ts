import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const apiTarget =
  process.env.VITE_API_URL ??
  process.env.API_URL ??
  // Aspire service discovery config injected into JS apps (common casing variants)
  process.env.SERVICES__server__http__0 ??
  process.env.SERVICES__SERVER__HTTP__0 ??
  process.env.services__server__http__0 ??
  process.env.SERVICES__server__https__0 ??
  process.env.SERVICES__SERVER__HTTPS__0 ??
  process.env.services__server__https__0 ??
  // Non-Aspire default (matches ManLab.Server launchSettings.json)
  'http://localhost:5247'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Bind to all interfaces so the dev server is reachable from other devices on the LAN
    // (e.g. phone/tablet/Raspberry Pi hitting http://<your-pc-ip>:5173).
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxy API requests to the backend server
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
      // Proxy SignalR hub requests with WebSocket support
      '/hubs': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  preview: {
    // Same idea as dev: allow testing from other devices.
    host: true,
  },
})
