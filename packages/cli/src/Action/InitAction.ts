import type { ConfigType } from "../Config/Config";
import { createRepo } from "../Factory/RepositoryFactory";
import { filterRepository } from "../utils/datatruck/config";
import { IfRequireKeys } from "../utils/ts";

export type InitActionOptions = {
  repositoryNames?: string[];
  repositoryTypes?: string[];
  verbose?: boolean;
};

export class InitAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, InitActionOptions>,
  ) {}

  async exec() {
    const result: {
      repositoryName: string;
      repositoryType: string;
      repositorySource: string;
      error: Error | null;
    }[] = [];

    for (const repoConfig of this.config.repositories) {
      if (!filterRepository(repoConfig, "init")) continue;
      if (
        this.options.repositoryNames &&
        !this.options.repositoryNames.includes(repoConfig.name)
      )
        continue;
      if (
        this.options.repositoryTypes &&
        !this.options.repositoryTypes.includes(repoConfig.type)
      )
        continue;
      const repo = createRepo(repoConfig);
      let initError: Error | null = null;

      try {
        await repo.init({
          options: this.options,
        });
      } catch (error) {
        initError = error as Error;
      }
      result.push({
        repositoryName: repoConfig.name,
        repositoryType: repoConfig.type,
        repositorySource: repo.getSource(),
        error: initError,
      });
    }

    return result;
  }
}
