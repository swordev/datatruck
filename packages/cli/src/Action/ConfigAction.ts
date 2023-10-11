import { GlobalOptions } from "../Command/CommandAbstract";
import type { ConfigType } from "../Config/Config";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { AppError } from "../Error/AppError";
import { schema } from "../JsonSchema/JsonSchema";
import { findRepositoryOrFail } from "../utils/datatruck/config";
import { findFile, parseFile, parseFileExtensions } from "../utils/fs";
import { IfRequireKeys } from "../utils/ts";
import Ajv from "ajv";
import { ok } from "assert";

export type ConfigActionOptions = {
  path: string;
  verbose?: boolean;
};

export class ConfigAction<TRequired extends boolean = true> {
  constructor(
    readonly options: IfRequireKeys<TRequired, ConfigActionOptions>,
  ) {}

  static validate(config: ConfigType) {
    const validate = new Ajv().compile(schema);
    if (!validate(config))
      throw new AppError(
        "Json schema error: " + JSON.stringify(validate.errors, null, 2),
      );
  }

  static check(config: ConfigType) {
    const repositoryNames: string[] = [];
    const mirrorRepoNames: string[] = [];
    const repos: Record<string, RepositoryConfigType> = {};
    for (const repo of config.repositories) {
      repos[repo.name] = repo;
      if (repositoryNames.includes(repo.name))
        throw new AppError(`Duplicated repository name: ${repo.name}`);
      repositoryNames.push(repo.name);
    }

    for (const repo of config.repositories) {
      if (repo.mirrorRepoNames) {
        for (const mirrorRepoName of repo.mirrorRepoNames) {
          if (!repos[mirrorRepoName])
            throw new AppError(
              `Mirror repository name not found: ${mirrorRepoName}`,
            );
          if (repos[mirrorRepoName].type !== repo.type)
            throw new AppError(
              `Mirror repository type is incompatible: ${mirrorRepoName}`,
            );
          if (mirrorRepoNames.includes(mirrorRepoName))
            throw new AppError(`Mirror repository is already used`);
          mirrorRepoNames.push(mirrorRepoName);
        }
      }
    }

    const packageNames: string[] = [];
    for (const pkg of config.packages) {
      if (packageNames.includes(pkg.name))
        throw new AppError(`Duplicated package name: ${pkg.name}`);
      repositoryNames.push(pkg.name);
    }
  }

  static normalize(config: ConfigType) {
    config = Object.assign({}, config);
    config.packages = config.packages.map((pkg) => {
      pkg = Object.assign({}, pkg);
      pkg.repositoryNames =
        pkg.repositoryNames ?? config.repositories.map((repo) => repo.name);
      ok(Array.isArray(pkg.repositoryNames));
      for (const repoName of pkg.repositoryNames)
        findRepositoryOrFail(config, repoName);
      return pkg;
    });
    return config;
  }

  static async fromGlobalOptionsWithPath(globalOptions: GlobalOptions<true>) {
    if (typeof globalOptions.config !== "string")
      return {
        path: null,
        data: globalOptions.config,
      };
    const configAction = new ConfigAction({
      path: globalOptions.config,
      verbose: !!globalOptions.verbose && globalOptions.verbose > 0,
    });
    return await configAction.exec();
  }

  static async fromGlobalOptions(globalOptions: GlobalOptions<true>) {
    const config = await ConfigAction.fromGlobalOptionsWithPath(globalOptions);
    return config.data;
  }

  async exec() {
    const path = await findFile(
      this.options.path,
      "datatruck.config",
      parseFileExtensions,
      "Config path not found",
    );
    const config: ConfigType = await parseFile(path, "config");
    ConfigAction.validate(config);
    ConfigAction.check(config);
    return {
      path,
      data: ConfigAction.normalize(config),
    };
  }
}
