import type { ConfigType } from "../Config/Config";
import { RepositoryFactory } from "../Factory/RepositoryFactory";
import { SnapshotResultType } from "../Repository/RepositoryAbstract";
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
  repositoryName: string;
  repositoryType: string;
} & SnapshotResultType;

export class SnapshotsAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, SnapshotsActionOptionsType>
  ) {}

  async exec() {
    let result: SnapshotExtendedType[] = [];
    for (const repo of this.config.repositories) {
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
      const snapshots = await repoInstance.onSnapshots({
        options: this.options,
      });
      const extentedItems = snapshots.map(
        (item) =>
          ({
            ...item,
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
