import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:1420", viewport: { width: 1100, height: 760 } },
  webServer: { command: "pnpm dev", url: "http://localhost:1420/src/cards/test-host.html", reuseExistingServer: true },
});
