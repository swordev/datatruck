import type { ConfigType } from "../Config/Config";
import { RepositoryConfigEnabledActionType } from "../Config/RepositoryConfig";
import { createRepo } from "../Factory/RepositoryFactory";
import { Snapshot } from "../Repository/RepositoryAbstract";
import { filterRepository } from "../utils/datatruck/config";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { IfRequireKeys } from "../utils/ts";

export type SnapshotGroupByType = keyof Pick<
  ExtendedSnapshot,
  "packageName" | "repositoryName" | "repositoryType"
>;
export type SnapshotsActionOptions = {
  ids?: string[];
  repositoryNames?: string[];
  packageNames?: string[];
  packageTaskNames?: string[];
  packageConfig?: boolean;
  repositoryTypes?: string[];
  verbose?: boolean;
  tags?: string[];
  last?: number;
  lastMinutely?: number;
  lastHourly?: number;
  lastDaily?: number;
  lastWeekly?: number;
  lastMonthly?: number;
  lastYearly?: number;
  groupBy?: SnapshotGroupByType[];
};

export type ExtendedSnapshot = {
  shortId: string;
  repositoryName: string;
  repositoryType: string;
} & Snapshot;

export class SnapshotsAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, SnapshotsActionOptions>,
  ) {}

  async exec(sourceAction?: RepositoryConfigEnabledActionType) {
    if (!sourceAction) sourceAction = "snapshots";
    let result: ExtendedSnapshot[] = [];
    for (const repoConfig of this.config.repositories) {
      if (!filterRepository(repoConfig, sourceAction)) continue;
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
      const configPackageNames = this.config.packages.map((pkg) => pkg.name);

      const packageNames = this.options.packageConfig
        ? this.options.packageNames?.filter((name) =>
            configPackageNames.includes(name),
          ) || configPackageNames
        : this.options.packageNames;

      const snapshots = await repo.fetchSnapshots({
        options: {
          ...this.options,
          packageNames,
        },
      });

      const extentedItems = snapshots.map(
        (ss) =>
          ({
            ...ss,
            shortId: ss.id.slice(0, 8),
            repositoryName: repoConfig.name,
            repositoryType: repoConfig.type,
          }) as ExtendedSnapshot,
      );
      result.push(...extentedItems);
    }
    result = result.sort((a, b) => b.date.localeCompare(a.date));

    return groupAndFilter(result, this.options.groupBy, this.options).map(
      ({ item }) => item,
    );
  }
}
