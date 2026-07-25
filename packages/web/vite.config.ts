import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import svgLoader from 'vite-svg-loader'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    svgLoader(),
    vueJsx(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // ghostty-web ships a sibling WASM file that the bundle loads at runtime via
  // its script's base href. If Vite pre-bundles ghostty-web into
  // /node_modules/.vite/deps/... that base href stops matching the public
  // /ghostty-vt.wasm we copied, so the load falls back to its absolute-path
  // attempt (`/ghostty-vt.wasm`) and still works — but skipping pre-bundling
  // avoids the double round-trip and keeps sourcemaps clean.
  optimizeDeps: {
    exclude: ['ghostty-web'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
