import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "npx tsx server/index.ts",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        E2E_FAKE_PROCESSING: "true",
        PORT: "3000"
      }
    },
    {
      command: "npx vite --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI
    }
  ]
});
