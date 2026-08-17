// Mock localStorage to prevent vue-devtools-kit crash in Node.js environments
const mockLocalStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
}
globalThis.localStorage = mockLocalStorage
if (typeof global !== 'undefined') {
  global.localStorage = mockLocalStorage
}

import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'

// Dynamic import to ensure global localStorage mock is defined before devtools loads
const { default: vueDevTools } = await import('vite-plugin-vue-devtools')

// Shared by `server` (dev) and `preview` (serving the production build). Vite
// does not carry server.proxy over to preview, so both reference this.
const apiPort = process.env.API_PORT || '9222'
const uiPort = Number.parseInt(process.env.UI_PORT || '5173', 10)
const notificationsPort = process.env.NOTIFICATIONS_PORT || '9223'

const proxy = {
  // Proxy API requests to the backend
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true
  },
  // Proxy AI requests to the AI backend
  '/ai': {
    target: 'http://localhost:5126',
    changeOrigin: true
  },
  // Proxy player stats requests to the backend
  '/stats': {
    target: `http://127.0.0.1:${apiPort}`,
    changeOrigin: true
  },
  // Proxy SignalR hub requests
  '/hub': {
    target: `http://localhost:${notificationsPort}`,
    changeOrigin: true,
    ws: true // Enable WebSocket proxying
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    vueDevTools(),
    ...(mode === 'analyze'
      ? [
          visualizer({
            filename: './dist/stats.html',
            open: false,
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split Vue core into its own chunk
          'vue-vendor': ['vue', 'vue-router', '@unhead/vue'],

          // Split Chart.js and related libs - only loads when charts are used
          'chart-vendor': ['chart.js', 'vue-chartjs', 'chartjs-plugin-annotation'],

          // Split PrimeVue into its own chunk
          'primevue-vendor': ['primevue'],

          // Split other heavy dependencies
          'misc-vendor': ['axios', '@microsoft/signalr', 'marked', 'jwt-decode'],
        }
      }
    },
    // Increase chunk size warning limit since we're intentionally creating larger vendor chunks
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: uiPort,
    watch: {
      // Playwright writes its report, traces, screenshots and videos into this
      // directory while the E2E suite is running. Without these ignores every
      // artifact write trips the watcher and pushes an HMR page reload into the
      // browsers that are mid-test — which both slows the run down and fails
      // tests outright. It is self-reinforcing: a failure writes a trace, the
      // trace reloads another page, that test fails too.
      ignored: [
        '**/playwright-report/**',
        '**/test-results/**',
        '**/dist/**',
      ],
    },
    proxy,
  },
  // `vite preview` does NOT inherit server.proxy — it needs its own copy, which
  // is why the shared `proxy` const above exists. Without this, serving the
  // built app locally 404s every /stats call and the dev auth bypass the E2E
  // suite logs in with.
  preview: {
    port: uiPort,
    strictPort: true,
    proxy,
  },
}))
