import { SnapshotGroupByType } from "../../Action/SnapshotsAction";
import { Snapshot } from "../../Repository/RepositoryAbstract";
import { filterByLast, FilterByLastOptionsType } from "../date";
import { groupBy } from "../object";

export function groupAndFilter<TSnapshot extends Snapshot>(
  snapshots: TSnapshot[],
  groupKeys?: SnapshotGroupByType[],
  inFilter?:
    | FilterByLastOptionsType
    | ((group: TSnapshot[]) => FilterByLastOptionsType | string),
): {
  item: TSnapshot;
  reasons: string[];
}[] {
  const groups = groupKeys?.length
    ? groupBy(snapshots, groupKeys as (keyof TSnapshot)[])
    : { "": snapshots };

  const keep: { item: TSnapshot; reasons: string[] }[] = [];

  for (const key in groups) {
    const filter =
      typeof inFilter === "function" ? inFilter(groups[key]) : inFilter || {};
    keep.push(
      ...(typeof filter === "string"
        ? groups[key].map((item) => ({ item, reasons: [filter] }))
        : filterByLast(groups[key], filter)),
    );
  }

  return snapshots
    .map((snapshot) => keep.find((v) => v.item === snapshot))
    .filter((v) => !!v) as any[];
}
