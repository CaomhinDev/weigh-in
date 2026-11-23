import { defineConfig, devices } from "@playwright/test";

// npm run test:e2e runs everything against the Firebase emulators (never the real project).
// Set BASE_URL to test a deployed copy (npm run test:live); sign-in tests are skipped then.
const remote = process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  // Sign-in tests need the Firebase emulators (npm run test:e2e starts them).
  testIgnore: remote ? /cloud\.spec\.js/ : undefined,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: remote ?? "http://127.0.0.1:8123/",
    ...devices["Pixel 7"],
    browserName: "chromium",
  },
  webServer: remote ? undefined : {
    command: "python3 -m http.server 8123 --bind 127.0.0.1",
    url: "http://127.0.0.1:8123",
    reuseExistingServer: true,
  },
});
