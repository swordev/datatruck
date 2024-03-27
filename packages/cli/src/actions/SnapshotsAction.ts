import { Snapshot } from "../repositories/RepositoryAbstract";
import { filterRepositoryByEnabled } from "../utils/datatruck/config";
import type {
  Config,
  RepositoryConfigEnabledAction,
} from "../utils/datatruck/config-type";
import { createAndInitRepo } from "../utils/datatruck/repository";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { InferOptions, defineOptionsConfig } from "../utils/options";
import { createPatternFilter, parseStringList } from "../utils/string";

export type SnapshotGroupByType = keyof Pick<
  ExtendedSnapshot,
  "packageName" | "repositoryName" | "repositoryType"
>;

const groupByValues: ("id" | SnapshotGroupByType)[] = [
  "id",
  "packageName",
  "repositoryName",
  "repositoryType",
];

export const snapshotsActionOptions = defineOptionsConfig({
  ids: {
    option: "-i,--id <ids>",
    description: "Filter by identifiers",
    parser: parseStringList<string>,
  },
  repositoryNames: {
    option: "-r,--repository <names>",
    description: "Filter by repository names",
    parser: parseStringList<string>,
  },
  repositoryTypes: {
    option: "-rt,--repository-type <names>",
    description: "Filter by repository types",
    parser: parseStringList<string>,
  },
  packageNames: {
    option: "-p,--package <names>",
    description: "Filter by package names",
    parser: parseStringList<string>,
  },
  packageTaskNames: {
    option: "-pt,--package-task <values>",
    description: "Filter by task names",
    parser: parseStringList<string>,
  },
  tags: {
    description: "Filter by tags",
    option: "-t,--tag <values>",
    parser: parseStringList<string>,
  },
  packageConfig: {
    description: "Filter by package config",
    option: "-pc,--package-config",
  },
  hostnames: {
    option: "-h,--host <values>",
    description: "Filter by hostnames",
    parser: parseStringList<string>,
  },
  groupBy: {
    option: "-g,--group-by <values>",
    description: `Group by values (${groupByValues.join(", ")})`,
    parser: (v) => parseStringList(v, groupByValues),
  },
  last: {
    option: "-l,--last <number>",
    description: "Filter by last snapshots",
    parser: Number,
  },
  lastMinutely: {
    option: "--lastMinutely <number>",
    description: "Filter by last minutely",
    parser: Number,
  },
  lastDaily: {
    option: "--lastDaily <number>",
    description: "Filter by last daily",
    parser: Number,
  },
  lastHourly: {
    option: "--lastHourly <number>",
    description: "Filter by last hourly",
    parser: Number,
  },
  lastMonthly: {
    option: "--lastMonthly <number>",
    description: "Filter by last monthly",
    parser: Number,
  },
  lastWeekly: {
    option: "--lastWeekly <number>",
    description: "Filter by last weekly",
    parser: Number,
  },
  lastYearly: {
    option: "--lastYearly <number>",
    description: "Filter by last yearly",
    parser: Number,
  },
});

export type SnapshotsActionOptions = InferOptions<
  typeof snapshotsActionOptions
> & {
  verbose?: boolean;
};

export type ExtendedSnapshot = {
  shortId: string;
  repositoryName: string;
  repositoryType: string;
} & Snapshot;

export class SnapshotsAction {
  constructor(
    readonly config: Config,
    readonly options: SnapshotsActionOptions,
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

    return groupAndFilter(
      result,
      this.options.groupBy as any,
      this.options,
    ).map(({ item }) => item);
  }
}
