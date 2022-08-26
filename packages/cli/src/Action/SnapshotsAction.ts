import type { ConfigType } from "../Config/Config";
import { RepositoryConfigEnabledActionType } from "../Config/RepositoryConfig";
import { RepositoryFactory } from "../Factory/RepositoryFactory";
import { SnapshotResultType } from "../Repository/RepositoryAbstract";
import { filterRepository } from "../util/datatruck/config-util";
import { groupAndFilter } from "../util/datatruck/snapshot-util";
import { IfRequireKeys } from "../util/ts-util";

export type SnapshotGroupByType = keyof Pick<
  SnapshotExtendedType,
  "packageName" | "repositoryName" | "repositoryType"
>;
export type SnapshotsActionOptionsType = {
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

export type SnapshotExtendedType = {
  shortId: string;
  repositoryName: string;
  repositoryType: string;
} & SnapshotResultType;

export class SnapshotsAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, SnapshotsActionOptionsType>
  ) {}

  async exec(sourceAction?: RepositoryConfigEnabledActionType) {
    if (!sourceAction) sourceAction = "snapshots";
    let result: SnapshotExtendedType[] = [];
    for (const repo of this.config.repositories) {
      if (!filterRepository(repo, sourceAction)) continue;
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
      const configPackageNames = this.config.packages.map((pkg) => pkg.name);
      const packageNames =
        this.options.packageNames?.filter((name) =>
          configPackageNames.includes(name)
        ) || configPackageNames;

      const snapshots = await repoInstance.onSnapshots({
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
            repositoryName: repo.name,
            repositoryType: repo.type,
          } as SnapshotExtendedType)
      );
      result.push(...extentedItems);
    }
    result = result.sort((a, b) => b.date.localeCompare(a.date));

    return groupAndFilter(result, this.options.groupBy, this.options);
  }
}
