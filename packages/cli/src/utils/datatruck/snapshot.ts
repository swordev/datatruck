import { SnapshotGroupByType } from "../../Action/SnapshotsAction";
import { Snapshot } from "../../Repository/RepositoryAbstract";
import { filterByLast, FilterByLastOptionsType } from "../date";
import { groupBy } from "../object";

export function groupAndFilter<TSnapshot extends Snapshot>(
  snapshots: TSnapshot[],
  groupByKey?: SnapshotGroupByType[],
  filter?:
    | FilterByLastOptionsType
    | ((groupedSnapshots: TSnapshot[]) => FilterByLastOptionsType),
  reasons?: Record<number, string[]>,
) {
  const grouped = groupByKey?.length
    ? groupBy(snapshots, groupByKey as any)
    : { "": snapshots };

  const result: typeof snapshots = [];

  for (const key in grouped) {
    if (filter) {
      const groupReasons: Record<number, string[]> | undefined = reasons
        ? {}
        : undefined;
      result.push(
        ...filterByLast(
          grouped[key],
          typeof filter === "function" ? filter(grouped[key]) : filter,
          groupReasons,
        ),
      );
      if (groupReasons && reasons) {
        for (const groupItemIndex in groupReasons) {
          const snapshot = grouped[key][groupItemIndex];
          const snapshotIndex = snapshots.indexOf(snapshot);
          reasons[snapshotIndex] = groupReasons[groupItemIndex];
        }
      }
    } else {
      result.push(...grouped[key]);
    }
  }

  return snapshots.filter((snapshot) => result.includes(snapshot));
}
