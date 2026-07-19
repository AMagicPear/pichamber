import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BACKEND_PORT = 1420;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  define: {
    // In dev mode the Vite proxy handles /api. At build time the
    // frontend is served by the Rust server on the same origin, so
    // no base override is needed.
    "window.__PICHAMBER_API_BASE__": JSON.stringify(""),
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
});
