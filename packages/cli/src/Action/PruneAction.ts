import type { ConfigType } from "../Config/Config";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { createRepo } from "../Factory/RepositoryFactory";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { groupBy } from "../utils/object";
import { IfRequireKeys } from "../utils/ts";
import {
  ExtendedSnapshot,
  SnapshotsAction,
  SnapshotsActionOptions,
} from "./SnapshotsAction";

export type PruneActionsOptions = {
  ids?: string[];
  packageNames?: string[];
  repositoryNames?: string[];
  repositoryTypes?: RepositoryConfigType["type"][];
  tags?: string[];
  keepLast?: number;
  keepMinutely?: number;
  keepHourly?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
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
    readonly config: ConfigType,
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
    const snapshotsAction = new SnapshotsAction<false>(
      this.config,
      this.options,
    );
    const snapshots = await snapshotsAction.exec("prune");
    const snapshotsDeleted: PruneResult["snapshots"] = [];
    const reasons: Record<number, string[]> = {};
    const inputFilter = {
      last: this.options.keepLast,
      lastMinutely: this.options.keepMinutely,
      lastHourly: this.options.keepHourly,
      lastDaily: this.options.keepDaily,
      lastMonthly: this.options.keepMonthly,
      lastWeekly: this.options.keepWeekly,
      lastYearly: this.options.keepYearly,
    };

    const hasInputFilter = Object.values(inputFilter).some(Number);
    const usePrunePolicyConfig =
      !hasInputFilter && this.options.groupBy?.includes("packageName");

    const keepSnapshots = groupAndFilter(
      snapshots,
      this.options.groupBy,
      usePrunePolicyConfig
        ? (groupedSnapshots) => {
            const [firstSnapshot] = groupedSnapshots;
            const packageName = firstSnapshot.packageName;
            const config = this.config.packages.find(
              (pkg) => pkg.name === packageName,
            );
            const prunePolicy = config?.prunePolicy ?? {};
            return {
              last: prunePolicy.keepLast,
              lastMinutely: prunePolicy.keepMinutely,
              lastHourly: prunePolicy.keepHourly,
              lastDaily: prunePolicy.keepDaily,
              lastMonthly: prunePolicy.keepMonthly,
              lastWeekly: prunePolicy.keepWeekly,
              lastYearly: prunePolicy.keepYearly,
            };
          }
        : inputFilter,
      reasons,
    );

    const result: PruneResult = {
      total: snapshots.length,
      prune: 0,
      snapshots: snapshotsDeleted,
    };

    let snapshotIndex = 0;

    for (const snapshot of snapshots) {
      const prune = !keepSnapshots.includes(snapshot);

      if (prune) result.prune++;

      if (prune || this.options.returnsAll)
        snapshotsDeleted.push({
          ...snapshot,
          exclusionReasons: reasons[snapshotIndex],
        });

      snapshotIndex++;
    }

    if (!this.options.dryRun) await this.confirm(snapshotsDeleted);

    return result;
  }
}
