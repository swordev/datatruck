import type { Config } from "../utils/datatruck/config-type";
import { createAndInitRepo } from "../utils/datatruck/repository";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { createFilterByLastOptions } from "../utils/date";
import { AppError } from "../utils/error";
import { groupBy, pickProps } from "../utils/object";
import { InferOptions, OptionsConfig } from "../utils/options";
import { parseStringList } from "../utils/string";
import {
  ExtendedSnapshot,
  SnapshotsAction,
  snapshotsActionOptions,
} from "./SnapshotsAction";

export const pruneActionOptions = {
  ids: {
    description: "Filter by snapshot id",
    option: "-i,--id <snapshotId>",
    parser: parseStringList<string>,
  },
  ...pickProps(snapshotsActionOptions, {
    packageNames: true,
    repositoryNames: true,
    repositoryTypes: true,
    tags: true,
  }),
  groupBy: {
    description:
      "Group by values (packageName, repositoryName, repositoryType)",
    option: "-g,--group-by <values>",
    defaults: "packageName, repositoryName",
    parser: (v) =>
      parseStringList(v, [
        "packageName",
        "repositoryName",
        "repositoryType",
      ]) as any,
  },
  dryRun: {
    description: "",
    option: "--dry-run",
    boolean: true,
  },
  showAll: {
    description: "Show all",
    option: "-a,--showAll",
  },
  keepMinutely: {
    description: "Keep last N minutely snapshots",
    option: "--keepMinutely <number>",
    parser: Number,
  },
  keepDaily: {
    description: "Keep last N daily snapshots",
    option: "--keepDaily <number>",
    parser: Number,
  },
  keepHourly: {
    description: "Keep last N hourly snapshots",
    option: "--keepHourly <number>",
    parser: Number,
  },
  keepLast: {
    description: "Keep last N snapshots",
    option: "--keepLast <number>",
    parser: Number,
  },
  keepMonthly: {
    description: "Keep last N monthly snapshots",
    option: "--keepMonthly <number>",
    parser: Number,
  },
  keepWeekly: {
    description: "Keep last N weekly snapshots",
    option: "--keepWeekly <number>",
    parser: Number,
  },
  keepYearly: {
    description: "Keep last N yearly snapshots",
    option: "--keepYearly <number>",
    parser: Number,
  },
} satisfies OptionsConfig;

export type PruneActionsOptions = InferOptions<typeof pruneActionOptions> & {
  verbose?: boolean;
};

export type PruneResult = {
  total: number;
  prune: number;
  snapshots: (ExtendedSnapshot & {
    exclusionReasons: string[];
  })[];
};

export class PruneAction {
  constructor(
    readonly config: Config,
    readonly options: PruneActionsOptions,
  ) {}

  async confirm(snapshots: PruneResult["snapshots"]) {
    const repository = groupBy(this.config.repositories, "name", true);

    for (const snapshot of snapshots) {
      if (!snapshot.exclusionReasons?.length) {
        const repo = await createAndInitRepo(
          repository[snapshot.repositoryName],
          this.options.verbose,
        );
        await repo.prune({
          snapshot: snapshot,
          options: { verbose: this.options.verbose },
        });
      }
    }
  }

  async exec() {
    const snapshotsAction = new SnapshotsAction(this.config, {
      groupBy: this.options.groupBy,
      ids: this.options.ids,
      packageNames: this.options.packageNames,
      repositoryNames: this.options.repositoryNames,
      repositoryTypes: this.options.repositoryTypes,
      tags: this.options.tags,
      verbose: this.options.verbose,
    });

    const snapshots = await snapshotsAction.exec("prune");
    const snapshotsDeleted: PruneResult["snapshots"] = [];
    const hasIdFilter = typeof this.options.ids !== "undefined";
    const keepFilter = createFilterByLastOptions(this.options);
    const hasKeepFilter = Object.values(keepFilter).some(
      (v) => typeof v === "number",
    );

    if (hasIdFilter && hasKeepFilter)
      throw new AppError(
        `Snapshot id filter can not be used with 'keep' filters`,
      );

    const prunePolicy = !hasIdFilter && !hasKeepFilter;

    if (prunePolicy && !this.options.groupBy?.includes("packageName"))
      throw new AppError(`Policy config requires groupBy packageName`);

    const keepSnapshots = hasKeepFilter
      ? groupAndFilter(snapshots, this.options.groupBy, keepFilter)
      : prunePolicy
        ? groupAndFilter(snapshots, this.options.groupBy, (groups) => {
            const [snapshot] = groups;
            const packageName = snapshot.packageName;
            const config = this.config.packages.find(
              (pkg) => pkg.name === packageName,
            );
            const prunePolicy =
              config?.prunePolicy ?? this.config.prunePolicy ?? {};
            const hasPrunePolicy = Object.values(prunePolicy).some(
              (v) => typeof v === "number",
            );
            return hasPrunePolicy
              ? createFilterByLastOptions(prunePolicy)
              : "no-policy";
          })
        : [];

    const result: PruneResult = {
      total: snapshots.length,
      prune: 0,
      snapshots: snapshotsDeleted,
    };

    let snapshotIndex = 0;

    for (const snapshot of snapshots) {
      const keepSnapshot = keepSnapshots.find(({ item }) => item === snapshot);
      const prune = !keepSnapshot;
      if (prune) result.prune++;
      if (prune || this.options.showAll)
        snapshotsDeleted.push({
          ...snapshot,
          exclusionReasons: keepSnapshot?.reasons || [],
        });

      snapshotIndex++;
    }

    if (!this.options.dryRun) await this.confirm(snapshotsDeleted);

    return result;
  }
}
