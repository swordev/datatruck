import type { ConfigType } from "../Config/Config";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { RepositoryFactory } from "../Factory/RepositoryFactory";
import { groupAndFilter } from "../util/datatruck/snapshot-util";
import { groupBy } from "../util/object-util";
import { IfRequireKeys } from "../util/ts-util";
import {
  SnapshotExtendedType,
  SnapshotsAction,
  SnapshotsActionOptionsType,
} from "./SnapshotsAction";

export type PruneActionsOptionsType = {
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
  groupBy?: SnapshotsActionOptionsType["groupBy"];
  dryRun?: boolean;
  longId?: boolean;
  returnsAll?: boolean;
};

export type PruneResultType = {
  total: number;
  prune: number;
  snapshots: (SnapshotExtendedType & {
    exclusionReasons: string[];
  })[];
};

export class PruneAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, PruneActionsOptionsType>
  ) {}

  async confirm(snapshots: PruneResultType["snapshots"]) {
    const repository = groupBy(this.config.repositories, "name", true);

    for (const snapshot of snapshots) {
      if (!snapshot.exclusionReasons?.length) {
        const repoInstance = RepositoryFactory(
          repository[snapshot.repositoryName]
        );
        await repoInstance.onPrune({
          snapshot: snapshot,
          options: { verbose: this.options.verbose },
        });
      }
    }
  }

  async exec() {
    const snapshotsAction = new SnapshotsAction<false>(
      this.config,
      this.options
    );
    const snapshots = await snapshotsAction.exec("prune");
    const snapshotsDeleted: PruneResultType["snapshots"] = [];
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
              (pkg) => pkg.name === packageName
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
      reasons
    );

    const result: PruneResultType = {
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
