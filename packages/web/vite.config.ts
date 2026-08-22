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
    // vite-svg-loader runs svgo by default; svgo's `preset-default` activates
    // `removeViewBox`, which strips `viewBox` from every imported svg. That's
    // wrong for every shape-aware icon in this project (lucide-static/*,
    // assets/icons/*, assets/provider-logos/* all rely on viewBox for clean
    // scaling into a sized box). Disable just that one optimisation.
    svgLoader({
      svgoConfig: {
        plugins: [
          {
            name: 'preset-default',
            params: {
              overrides: {
                removeViewBox: false,
              },
            },
          },
        ],
      },
    }),
    vueJsx(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // The app imports ghostty-web's WASM through `?url` in useGhostty.ts.
  // Keep the package out of Vite's dependency pre-bundle so that import
  // remains a normal asset URL in both dev and production builds.
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
