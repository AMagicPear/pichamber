import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const BACKEND_PORT = 1420;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      // OpenChamber `packages/ui` source vendored under src/vendor/openchamber.
      // The `@/` alias mirrors OpenChamber's internal resolution so we can copy
      // files across wholesale without rewriting import paths.
      "@": path.resolve(__dirname, "src/vendor/openchamber"),
      "@openchamber/ui": path.resolve(__dirname, "src/vendor/openchamber"),
    },
  },
  server: {
    port: 5173,
  },
  define: {
    // In dev mode API calls go directly to the backend — no proxy.
    // At build time the frontend is served by the Bun server on the
    // same origin, so no base override is needed.
    "window.__PICHAMBER_API_BASE__": JSON.stringify(`http://localhost:${BACKEND_PORT}`),
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  // OpenChamber's markdown pipeline ships a Shiki worker that imports
  // ?worker&url. Both plugin-react and tailwindcss/vite already emit
  // worker-aware assets; leave Vite's default handling in place.
  worker: {
    format: "es",
  },
});
