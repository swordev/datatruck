import { defineConfig } from "vite";

export default defineConfig({
  test: {
    globalSetup: ["./packages/cli/test/globalSetup.ts"],
    include: ["./packages/*/test/**/*.test.ts"],
    ...(process.env.GITHUB_ACTIONS === "true" && {
      exclude: ["./packages/cli/test/mysql-dump-task.test.ts"],
    }),
  },
});
