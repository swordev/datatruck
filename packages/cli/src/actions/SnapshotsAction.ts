import { Snapshot } from "../repositories/RepositoryAbstract";
import { filterRepositoryByEnabled } from "../utils/datatruck/config";
import type {
  Config,
  RepositoryConfigEnabledAction,
} from "../utils/datatruck/config-type";
import { createAndInitRepo } from "../utils/datatruck/repository";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { createPatternFilter } from "../utils/string";
import { IfRequireKeys } from "../utils/ts";

export type SnapshotGroupByType = keyof Pick<
  ExtendedSnapshot,
  "packageName" | "repositoryName" | "repositoryType"
>;
export type SnapshotsActionOptions = {
  ids?: string[];
  hostnames?: string[];
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
    readonly config: Config,
    readonly options: IfRequireKeys<TRequired, SnapshotsActionOptions>,
  ) {}

  async exec(sourceAction?: RepositoryConfigEnabledAction) {
    if (!sourceAction) sourceAction = "snapshots";
    let result: ExtendedSnapshot[] = [];
    const filterHost = createPatternFilter(this.options.hostnames);
    const filterRepo = createPatternFilter(this.options.repositoryNames);
    const filterRepoType = createPatternFilter(this.options.repositoryTypes);
    for (const repoConfig of this.config.repositories) {
      if (!filterRepositoryByEnabled(repoConfig, sourceAction)) continue;
      if (!filterRepo(repoConfig.name)) continue;
      if (!filterRepoType(repoConfig.type)) continue;
      const repo = await createAndInitRepo(repoConfig, this.options.verbose);
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

      let extentedItems = snapshots.map(
        (ss) =>
          ({
            ...ss,
            shortId: ss.id.slice(0, 8),
            repositoryName: repoConfig.name,
            repositoryType: repoConfig.type,
          }) as ExtendedSnapshot,
      );
      if (this.options.hostnames)
        extentedItems = extentedItems.filter((s) => filterHost(s.hostname));
      result.push(...extentedItems);
    }
    result = result.sort((a, b) => b.date.localeCompare(a.date));

    return groupAndFilter(result, this.options.groupBy, this.options).map(
      ({ item }) => item,
    );
  }
}
