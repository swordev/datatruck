import { defineConfig } from "vite";

export default defineConfig({
  test: {
    globalSetup: ["./packages/cli/test/globalSetup.ts"],
    include: ["./packages/*/test/**/*.test.ts"],
  },
});