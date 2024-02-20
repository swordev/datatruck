import { PreSnapshot } from "../../repositories/RepositoryAbstract";
import { SpawnStep, runSpawnSteps } from "../spawnSteps";
import type { PackageConfig } from "./config-type";

export type ParsePathsOptions = {
  cwd?: string;
  verbose?: boolean;
  data?: Record<string, any>;
  tempDir?: () => Promise<string>;
};

export async function parsePaths(
  values: (string | SpawnStep)[],
  options: ParsePathsOptions,
) {
  let paths: string[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      paths.push(value);
    } else {
      await runSpawnSteps(value, {
        tempDir: options.tempDir,
        verbose: options.verbose,
        onLine: (path) => paths.push(path),
      });
    }
  }
  return paths;
}

export type BackupPathsOptions = {
  package: Pick<PackageConfig, "name" | "path" | "include" | "exclude">;
  snapshot: PreSnapshot;
  path: string;
  verbose?: boolean;
};

export async function parseBackupPaths(
  paths: (string | SpawnStep)[],
  options: BackupPathsOptions,
) {
  return parsePaths(paths, {
    cwd: options.path,
    verbose: options.verbose,
    data: {
      package: options.package,
      snapshot: options.snapshot,
      path: options.path,
    },
  });
}
