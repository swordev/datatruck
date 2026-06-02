// @ts-check
import { createTSConfigFiles, defineConfig } from "@dreamkit/workspace";

export default defineConfig(({ pkg, packages }) => {
  return {
    files: createTSConfigFiles({
      pkg,
      packages,
      cjs: false,
      build: {
        extends: ["@tsconfig/node20"],
        include: ["src"],
        compilerOptions: { rootDir: "src", outDir: "lib" },
      },
      base: {
        include: ["src", "test"],
        compilerOptions: { rootDir: "." },
      },
    }),
  };
});
