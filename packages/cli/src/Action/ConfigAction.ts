import { GlobalOptionsType } from "../Command/CommandAbstract";
import type { ConfigType } from "../Config/Config";
import { AppError } from "../Error/AppError";
import { schema } from "../JsonSchema/JsonSchema";
import { findRepositoryOrFail } from "../util/datatruck/config-util";
import { findFile, parseFile, parseFileExtensions } from "../util/fs-util";
import { IfRequireKeys } from "../util/ts-util";
import Ajv from "ajv";
import { ok } from "assert";
import { normalize } from "path";

export type ConfigActionOptionsType = {
  path: string;
  verbose?: boolean;
};

export class ConfigAction<TRequired extends boolean = true> {
  constructor(
    readonly options: IfRequireKeys<TRequired, ConfigActionOptionsType>
  ) {}

  static validate(config: ConfigType) {
    const validate = new Ajv().compile(schema);
    if (!validate(config))
      throw new AppError(
        "Json schema error: " + JSON.stringify(validate.errors, null, 2)
      );
  }

  static check(config: ConfigType) {
    const repositoryNames: string[] = [];
    for (const repo of config.repositories) {
      if (repositoryNames.includes(repo.name))
        throw new AppError(`Duplicated repository name: ${repo.name}`);
      repositoryNames.push(repo.name);
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
      if (!pkg.restorePath)
        pkg.restorePath = pkg.path
          ? pkg.path
          : normalize(`{temp}/{snapshotId}-{action}/{packageName}`);
      if (!pkg.path)
        pkg.path = normalize(`{temp}/{snapshotId}-{action}/{packageName}`);
      pkg.repositoryNames =
        pkg.repositoryNames ?? config.repositories.map((repo) => repo.name);
      ok(Array.isArray(pkg.repositoryNames));
      for (const repoName of pkg.repositoryNames)
        findRepositoryOrFail(config, repoName);
      return pkg;
    });
    return config;
  }

  static async fromGlobalOptions(globalOptions: GlobalOptionsType<true>) {
    if (typeof globalOptions.config === "string") {
      const configAction = new ConfigAction({
        path: globalOptions.config,
        verbose: !!globalOptions.verbose && globalOptions.verbose > 0,
      });
      const result = await configAction.exec();
      return result.data;
    } else {
      return globalOptions.config;
    }
  }

  async exec() {
    const path = await findFile(
      this.options.path,
      "datatruck.config",
      parseFileExtensions,
      "Config path not found"
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
