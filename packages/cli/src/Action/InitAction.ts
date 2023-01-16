import type { ConfigType } from "../Config/Config";
import { RepositoryFactory } from "../Factory/RepositoryFactory";
import { filterRepository } from "../utils/datatruck/config";
import { IfRequireKeys } from "../utils/ts";

export type InitActionOptionsType = {
  repositoryNames?: string[];
  repositoryTypes?: string[];
  verbose?: boolean;
};

export class InitAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, InitActionOptionsType>
  ) {}

  async exec() {
    const result: {
      repositoryName: string;
      repositoryType: string;
      repositorySource: string;
      error: Error | null;
    }[] = [];

    for (const repo of this.config.repositories) {
      if (!filterRepository(repo, "init")) continue;
      if (
        this.options.repositoryNames &&
        !this.options.repositoryNames.includes(repo.name)
      )
        continue;
      if (
        this.options.repositoryTypes &&
        !this.options.repositoryTypes.includes(repo.type)
      )
        continue;
      const repoInstance = RepositoryFactory(repo);
      let initError: Error | null = null;

      try {
        await repoInstance.onInit({
          options: this.options,
        });
      } catch (error) {
        initError = error as Error;
      }
      result.push({
        repositoryName: repo.name,
        repositoryType: repo.type,
        repositorySource: repoInstance.onGetSource(),
        error: initError,
      });
    }

    return result;
  }
}
