import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      PORT: "3100",
      TYPESAFE_MODE: "demo",
      TYPESAFE_API_KEY: "",
      TYPESAFE_DEFAULT_MODEL: "jev-latest",
    },
  },
});
