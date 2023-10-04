import { defineConfig } from "vite";

export default defineConfig({
  test: {
    setupFiles: ["./packages/cli/test/vitest.setup.ts"],
    globalSetup: ["./packages/cli/test/globalSetup.ts"],
    include: ["./packages/*/test/**/*.test.ts"],
  },
});
