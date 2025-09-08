import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [
        { browser: "chromium" },
      ],
    },
    include: ["out/esm/test/load.test.js", "out/esm/test/refresh.test.js", "out/esm/test/featureFlag.test.js", "out/esm/test/json.test.js", "out/esm/test/startup.test.js", "out/esm/test/cdn.test.js"],
    testTimeout: 200_000,
    hookTimeout: 200_000,
    reporters: "default",
    globals: true,
    // Provide Mocha-style hooks as globals
    setupFiles: ["./vitest.setup.mjs"],
  },
});