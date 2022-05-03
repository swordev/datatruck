import { ConfigType } from "../../Config/Config";
import type { PackageConfigType } from "../../Config/PackageConfig";
import { AppError } from "../../Error/AppError";
import { tmpDir } from "../fs-util";
import { makePathPatterns, render } from "../string-util";
import { isMatch } from "micromatch";

export function findRepositoryOrFail(
  config: ConfigType,
  repositoryName: string
) {
  const repo = config.repositories.find((v) => v.name === repositoryName);
  if (!repo) throw new AppError(`Repository '${repositoryName}' not found`);
  return repo;
}

export function filterPackages(
  config: ConfigType,
  options: {
    packageNames?: string[];
    repositoryNames?: string[];
    repositoryTypes?: string[];
  }
) {
  const packagePatterns = makePathPatterns(options.packageNames);

  return config.packages
    .map((pkg) => {
      pkg = Object.assign({}, pkg);
      pkg.repositoryNames = (pkg.repositoryNames ?? []).filter((name) => {
        const repo = findRepositoryOrFail(config, name);
        return (
          (!options.repositoryNames ||
            options.repositoryNames.includes(name)) &&
          (!options.repositoryTypes ||
            options.repositoryTypes.includes(repo.type))
        );
      });
      return pkg;
    })
    .filter((pkg) => {
      return (
        (typeof pkg.enabled !== "boolean" || pkg.enabled) &&
        !!pkg.repositoryNames?.length &&
        (!packagePatterns || isMatch(pkg.name, packagePatterns))
      );
    });
}

type ResolvePackagePathParamsType = ResolvePackageParamsType & {
  packageName: string;
  path: string | undefined;
};

export function resolvePackagePath(
  value: string,
  params: ResolvePackagePathParamsType
) {
  return render(value, {
    ...params,
    ...{
      temp: tmpDir("pkg"),
    },
  });
}

type ResolveDatabaseNameParamsType = ResolvePackageParamsType & {
  packageName: string;
  database: string | undefined;
};

export function resolveDatabaseName(
  value: string,
  params: ResolveDatabaseNameParamsType
) {
  return render(value, params);
}

type ResolvePackageParamsType = {
  snapshotId: string;
  action: "backup" | "restore";
};

export function resolvePackage(
  pkg: PackageConfigType,
  params: ResolvePackageParamsType
) {
  pkg = Object.assign({}, pkg);
  const pkgParams = {
    ...params,
    packageName: pkg.name,
    path: undefined,
  };
  if (pkg.path) pkg.path = resolvePackagePath(pkg.path, pkgParams);
  if (pkg.restorePath)
    pkg.restorePath = resolvePackagePath(pkg.restorePath, {
      ...pkgParams,
      path: pkg.path,
    });
  return pkg;
}

export function resolvePackages(
  packages: PackageConfigType[],
  params: ResolvePackageParamsType
) {
  return packages.map((pkg) => resolvePackage(pkg, params));
}

export const pkgPathParams: {
  [name in
    | "temp"
    | Exclude<keyof ResolvePackagePathParamsType, "path">]: string;
} = {
  action: "{action}",
  packageName: "{packageName}",
  snapshotId: "{snapshotId}",
  temp: "{temp}",
};

export const pkgRestorePathParams: {
  [name in "temp" | keyof ResolvePackagePathParamsType]: string;
} = {
  action: "{action}",
  packageName: "{packageName}",
  path: "{path}",
  snapshotId: "{snapshotId}",
  temp: "{temp}",
};

export const dbNameParams: {
  [name in keyof ResolveDatabaseNameParamsType]: string;
} = {
  action: "{action}",
  packageName: "{packageName}",
  snapshotId: "{snapshotId}",
  database: "{database}",
};

export const params = {
  pkgPath: pkgPathParams,
  pkgRestorePath: pkgRestorePathParams,
  dbName: dbNameParams,
};
