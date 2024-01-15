import { AppError } from "../error";
import { checkMatch, makePathPatterns, render } from "../string";
import { tmpDir } from "../temp";
import type { Config } from "./config-type";
import type {
  PackageConfig,
  RepositoryConfigEnabledAction,
  RepositoryConfig,
} from "./config-type";
import { isMatch } from "micromatch";

export function findRepositoryOrFail(config: Config, repositoryName: string) {
  const repo = config.repositories.find((v) => v.name === repositoryName);
  if (!repo) throw new AppError(`Repository '${repositoryName}' not found`);
  return repo;
}

export function findPackageOrFail(config: Config, packageName: string) {
  const pkg = config.packages.find((v) => v.name === packageName);
  if (!pkg) throw new AppError(`Package '${packageName}' not found`);
  return pkg;
}

export function findPackageRepositoryConfig(
  pkg: PackageConfig,
  repo: RepositoryConfig,
) {
  return pkg.repositoryConfigs?.find(
    (config) =>
      config.type === repo.type &&
      (!config.names || config.names.includes(repo.name)),
  )?.config;
}

export function filterRepository(
  repositories: RepositoryConfig[],
  options: {
    include?: string[];
    exclude?: string[];
    action?: RepositoryConfigEnabledAction;
  },
) {
  return repositories.filter((r) => {
    if (options.include && !options.include.includes(r.name)) return false;
    if (options.exclude && options.exclude.includes(r.name)) return false;
    if (options.action && !filterRepositoryByEnabled(r, options.action))
      return false;
    return true;
  });
}
export function sortReposByType<
  T extends { name: string; type: RepositoryConfig["type"] },
>(repositories: T[], types?: RepositoryConfig["type"][]): T[] {
  const groups = repositories.reduce(
    (group, item) => {
      if (!group[item.type]) group[item.type] = [];
      group[item.type].push(item);
      return group;
    },
    {} as Record<RepositoryConfig["type"], typeof repositories>,
  );
  const result: typeof repositories = [];

  const sortedTypes = [
    ...new Set([...(types || []), ...Object.keys(groups)]),
  ] as RepositoryConfig["type"][];

  for (const type of sortedTypes) {
    const group = groups[type];
    if (group)
      result.push(...group.sort((a, b) => a.name.localeCompare(b.name)));
  }
  return result;
}

export function ensureSameRepositoryType(
  a: RepositoryConfig,
  b: RepositoryConfig,
) {
  if (a.type !== b.type) {
    const names = [a.name, b.name].join(" and ");
    const types = [a.type, b.type].join(" != ");
    throw new AppError(
      `Incompatible repository types between ${names} (${types})`,
    );
  }
}

export function filterRepositoryByEnabled(
  repository: RepositoryConfig,
  action?: RepositoryConfigEnabledAction,
) {
  const enabled = repository.enabled ?? true;
  if (typeof enabled === "boolean") return enabled;
  const defaults = enabled["defaults"] ?? true;
  return action ? enabled[action] ?? defaults : true;
}

export function filterPackages(
  config: Config,
  options: {
    packageNames?: string[];
    packageTaskNames?: string[];
    repositoryNames?: string[];
    repositoryTypes?: string[];
    sourceAction?: RepositoryConfigEnabledAction;
  },
) {
  const packagePatterns = makePathPatterns(options.packageNames);
  const taskNamePatterns = makePathPatterns(options.packageTaskNames);

  return config.packages
    .map((pkg) => {
      pkg = Object.assign({}, pkg);
      pkg.repositoryNames = (pkg.repositoryNames ?? []).filter((name) => {
        const repo = findRepositoryOrFail(config, name);
        if (!filterRepositoryByEnabled(repo, options?.sourceAction))
          return false;
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
      if (taskNamePatterns && !checkMatch(pkg.task?.name, taskNamePatterns))
        return false;
      return (
        (typeof pkg.enabled !== "boolean" || pkg.enabled) &&
        !!pkg.repositoryNames?.length &&
        (!packagePatterns || isMatch(pkg.name, packagePatterns))
      );
    });
}

type ResolvePackagePathParams = ResolvePackageParams & {
  packageName: string;
  path: string | undefined;
};

export function resolvePackagePath(
  value: string,
  params: ResolvePackagePathParams,
) {
  return render(value, {
    ...params,
    ...{
      temp: tmpDir("pkg"),
    },
  });
}

export type ResolveDatabaseNameParams = ResolvePackageParams & {
  packageName: string;
  database: string | undefined;
};

export function resolveDatabaseName(
  value: string,
  params: ResolveDatabaseNameParams,
) {
  return render(value, params);
}

type ResolvePackageParams = {
  snapshotId: string;
  snapshotDate: string;
  action: "backup" | "restore";
};

export function resolvePackage(
  pkg: PackageConfig,
  params: ResolvePackageParams,
) {
  pkg = Object.assign({}, pkg);
  const pkgParams = {
    ...params,
    packageName: pkg.name,
    path: undefined,
  };
  if (pkg.include)
    pkg.include = pkg.include.map((v) =>
      typeof v === "string" ? render(v, pkgParams) : v,
    );
  if (pkg.exclude)
    pkg.exclude = pkg.exclude.map((v) =>
      typeof v === "string" ? render(v, pkgParams) : v,
    );
  if (pkg.path) pkg.path = resolvePackagePath(pkg.path, pkgParams);
  if (pkg.restorePath)
    pkg.restorePath = resolvePackagePath(pkg.restorePath, {
      ...pkgParams,
      path: pkg.path,
    });
  return pkg;
}

export function resolvePackages(
  packages: PackageConfig[],
  params: ResolvePackageParams,
) {
  return packages.map((pkg) => resolvePackage(pkg, params));
}

export const pkgPathParams: {
  [name in "temp" | Exclude<keyof ResolvePackagePathParams, "path">]: string;
} = {
  action: "{action}",
  packageName: "{packageName}",
  snapshotId: "{snapshotId}",
  snapshotDate: "{snapshotDate}",
  temp: "{temp}",
};

export const pkgIncludeParams = pkgPathParams;
export const pkgExcludeParams = pkgPathParams;

export const pkgRestorePathParams: {
  [name in "temp" | keyof ResolvePackagePathParams]: string;
} = {
  action: "{action}",
  packageName: "{packageName}",
  path: "{path}",
  snapshotId: "{snapshotId}",
  snapshotDate: "{snapshotDate}",
  temp: "{temp}",
};

export const dbNameParams: {
  [name in keyof ResolveDatabaseNameParams]: string;
} = {
  action: "{action}",
  packageName: "{packageName}",
  snapshotId: "{snapshotId}",
  snapshotDate: "{snapshotDate}",
  database: "{database}",
};

export const params = {
  pkgPath: pkgPathParams,
  pkgRestorePath: pkgRestorePathParams,
  pkgInclude: pkgIncludeParams,
  pkgExclude: pkgExcludeParams,
  dbName: dbNameParams,
};
