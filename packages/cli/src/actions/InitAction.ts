import { filterRepositoryByEnabled } from "../utils/datatruck/config";
import type { Config } from "../utils/datatruck/config-type";
import { createRepo } from "../utils/datatruck/repository";
import { createPatternFilter } from "../utils/string";
import { IfRequireKeys } from "../utils/ts";

export type InitActionOptions = {
  repositoryNames?: string[];
  repositoryTypes?: string[];
  verbose?: boolean;
};

export class InitAction<TRequired extends boolean = true> {
  constructor(
    readonly config: Config,
    readonly options: IfRequireKeys<TRequired, InitActionOptions>,
  ) {}

  async exec() {
    const result: {
      repositoryName: string;
      repositoryType: string;
      repositorySource: string;
      error: Error | null;
    }[] = [];

    const filterRepo = createPatternFilter(this.options.repositoryNames);
    const filterRepoType = createPatternFilter(this.options.repositoryTypes);

    for (const repoConfig of this.config.repositories) {
      if (!filterRepositoryByEnabled(repoConfig, "init")) continue;
      if (!filterRepo(repoConfig.name)) continue;
      if (!filterRepoType(repoConfig.type)) continue;
      const repo = createRepo(repoConfig, this.options.verbose);
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
