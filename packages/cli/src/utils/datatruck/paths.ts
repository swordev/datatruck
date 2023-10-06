import { PackageConfigType } from "../../Config/PackageConfig";
import { PreSnapshot } from "../../Repository/RepositoryAbstract";
import { Step, runSteps } from "../steps";

export type ParsePathsOptions = {
  cwd?: string;
  verbose?: boolean;
  vars?: Record<string, any>;
};

export async function parsePaths(
  values: (string | Step)[],
  options: {
    cwd?: string;
    verbose?: boolean;
    vars?: Record<string, any>;
    tempDir?: () => Promise<string>;
  },
) {
  let paths: string[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      paths.push(value);
    } else {
      await runSteps(value, {
        node: { tempDir: options.tempDir },
        verbose: options.verbose,
        onLine: (path) => paths.push(path),
      });
    }
  }
  return paths;
}

export type BackupPathsOptions = {
  package: PackageConfigType;
  snapshot: PreSnapshot;
  path: string;
  verbose?: boolean;
};

export async function parseBackupPaths(
  paths: (string | Step)[],
  options: BackupPathsOptions,
) {
  return parsePaths(paths, {
    cwd: options.path,
    verbose: options.verbose,
    vars: {
      dtt: {
        package: options.package,
        snapshot: options.snapshot,
        path: options.path,
      },
    },
  });
}
