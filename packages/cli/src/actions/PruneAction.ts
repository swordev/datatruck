import type { Config, RepositoryConfig } from "../utils/datatruck/config-type";
import { createRepo } from "../utils/datatruck/repository";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { KeepObject, createFilterByLastOptions } from "../utils/date";
import { groupBy } from "../utils/object";
import { IfRequireKeys } from "../utils/ts";
import {
  ExtendedSnapshot,
  SnapshotsAction,
  SnapshotsActionOptions,
} from "./SnapshotsAction";

export type PruneActionsOptions = KeepObject & {
  ids?: string[];
  packageNames?: string[];
  repositoryNames?: string[];
  repositoryTypes?: RepositoryConfig["type"][];
  tags?: string[];
  verbose?: boolean;
  groupBy?: SnapshotsActionOptions["groupBy"];
  dryRun?: boolean;
  longId?: boolean;
  returnsAll?: boolean;
};

export type PruneResult = {
  total: number;
  prune: number;
  snapshots: (ExtendedSnapshot & {
    exclusionReasons: string[];
  })[];
};

export class PruneAction<TRequired extends boolean = true> {
  constructor(
    readonly config: Config,
    readonly options: IfRequireKeys<TRequired, PruneActionsOptions>,
  ) {}

  async confirm(snapshots: PruneResult["snapshots"]) {
    const repository = groupBy(this.config.repositories, "name", true);

    for (const snapshot of snapshots) {
      if (!snapshot.exclusionReasons?.length) {
        const repo = createRepo(repository[snapshot.repositoryName]);
        await repo.prune({
          snapshot: snapshot,
          options: { verbose: this.options.verbose },
        });
      }
    }
  }

  async exec() {
    const snapshotsAction = new SnapshotsAction<false>(this.config, {
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
      throw new Error(`Snapshot id filter can not be used with 'keep' filters`);

    const prunePolicy = !hasIdFilter && !hasKeepFilter;

    if (prunePolicy && !this.options.groupBy?.includes("packageName"))
      throw new Error(`Policy config requires groupBy packageName`);

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
      if (prune || this.options.returnsAll)
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
