import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://127.0.0.1:1420", screenshot: "only-on-failure" },
  webServer: {
    command: "bun run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
});

