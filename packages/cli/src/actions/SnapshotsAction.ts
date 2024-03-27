import { Snapshot } from "../repositories/RepositoryAbstract";
import { filterRepositoryByEnabled } from "../utils/datatruck/config";
import type {
  Config,
  RepositoryConfigEnabledAction,
} from "../utils/datatruck/config-type";
import { createAndInitRepo } from "../utils/datatruck/repository";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { InferOptions, OptionsConfig } from "../utils/options";
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

export const snapshotsActionOptions = {
  ids: {
    description: "Filter by identifiers",
    shortFlag: "i",
    value: "array",
  },
  repositoryNames: {
    description: "Filter by repository names",
    shortFlag: "r",
    value: "array",
  },
  repositoryTypes: {
    description: "Filter by repository types",
    shortFlag: "rt",
    value: "array",
  },
  packageNames: {
    description: "Filter by package names",
    shortFlag: "p",
    value: "array",
  },
  packageTaskNames: {
    description: "Filter by task names",
    shortFlag: "pt",
    value: "array",
  },
  tags: {
    description: "Filter by tags",
    shortFlag: "t",
    value: "array",
  },
  packageConfig: {
    description: "Filter by package config",
    shortFlag: "pc",
  },
  hostnames: {
    description: "Filter by hostnames",
    shortFlag: "h",
    value: "array",
  },
  groupBy: {
    description: `Group by values (${groupByValues.join(", ")})`,
    shortFlag: "g",
    value: (v) => parseStringList(v, groupByValues),
  },
  last: {
    description: "Filter by last snapshots",
    shortFlag: "l",
    value: "number",
  },
  lastMinutely: {
    description: "Filter by last minutely",
    value: "number",
  },
  lastDaily: {
    description: "Filter by last daily",
    value: "number",
  },
  lastHourly: {
    description: "Filter by last hourly",
    value: "number",
  },
  lastMonthly: {
    description: "Filter by last monthly",
    value: "number",
  },
  lastWeekly: {
    description: "Filter by last weekly",
    value: "number",
  },
  lastYearly: {
    description: "Filter by last yearly",
    value: "number",
  },
} satisfies OptionsConfig;

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
