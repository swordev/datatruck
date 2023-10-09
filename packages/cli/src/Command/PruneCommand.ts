import { ConfigAction } from "../Action/ConfigAction";
import { PruneAction } from "../Action/PruneAction";
import { SnapshotGroupByType } from "../Action/SnapshotsAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { DataFormat } from "../utils/DataFormat";
import { confirm } from "../utils/cli";
import { parseStringList } from "../utils/string";
import { If } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type PruneCommandOptions<TResolved = false> = {
  id?: If<TResolved, string[]>;
  longId?: boolean;
  package?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
  tag?: If<TResolved, string[]>;
  keepLast?: number;
  keepMinutely?: number;
  keepHourly?: number;
  keepDaily?: number;
  keepWeekly?: number;
  keepMonthly?: number;
  keepYearly?: number;
  groupBy?: If<TResolved, SnapshotGroupByType[]>;
  dryRun?: boolean;
  showAll?: boolean;
  confirm?: boolean;
};

export class PruneCommand extends CommandAbstract<
  PruneCommandOptions<false>,
  PruneCommandOptions<true>
> {
  override onOptions() {
    return this.returnsOptions({
      dryRun: {
        description: "",
        option: "--dry-run",
        parser: undefined,
      },
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
      id: {
        description: "Filter by snapshot id",
        option: "-i,--id <snapshotId>",
        parser: parseStringList,
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
      longId: {
        description: "Show long snapshot id",
        option: "--longId",
      },
      package: {
        description: "Filter by package names",
        option: "-p,--package <values>",
        parser: parseStringList,
      },
      repository: {
        description: "Filter by repository names",
        option: "-r,--repository <values>",
        parser: parseStringList,
      },
      repositoryType: {
        description: "Filter by repository types",
        option: "-rt,--repository-type <values>",
        parser: (v) => parseStringList(v) as any,
      },
      tag: {
        description: "Filter by tags",
        option: "-t,--tag <values>",
        parser: parseStringList,
      },
      showAll: {
        description: "Show all",
        option: "-a,--showAll",
      },
      confirm: {
        description: "Confirm action",
        option: "--confirm",
      },
    });
  }

  override async onExec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);

    const prune = new PruneAction(config, {
      ids: this.options.id,
      packageNames: this.options.package,
      repositoryNames: this.options.repository,
      repositoryTypes: this.options.repositoryType,
      verbose: verbose > 0,
      dryRun: this.options.dryRun || !this.options.confirm,
      groupBy: this.options.groupBy,
      keepLast: this.options.keepLast,
      keepMinutely: this.options.keepMinutely,
      keepHourly: this.options.keepHourly,
      keepDaily: this.options.keepDaily,
      keepMonthly: this.options.keepMonthly,
      keepWeekly: this.options.keepWeekly,
      keepYearly: this.options.keepYearly,
      tags: this.options.tag,
      longId: this.options.longId,
      returnsAll: this.options.showAll,
    });

    const pruneResult = await prune.exec();
    const dataFormat = new DataFormat({
      items: pruneResult.snapshots,
      table: {
        labels: [
          "Id.",
          "Date",
          "Package",
          "Repository",
          "Repository type",
          "Exclusion reasons",
        ],
        handler: (item) => [
          this.options.longId ? item.id : item.id.slice(0, 8),
          item.date.replace("T", " ").replace("Z", ""),
          item.packageName,
          item.repositoryName,
          item.repositoryType,
          item.exclusionReasons?.join(", ") ?? "",
        ],
      },
    });

    if (this.globalOptions.outputFormat)
      console.info(dataFormat.format(this.globalOptions.outputFormat));

    if (!this.options.confirm && !this.options.dryRun) {
      const answer = await confirm(
        `Delete ${pruneResult.prune}/${pruneResult.total} snapshots?`,
      );
      if (answer) await prune.confirm(pruneResult.snapshots);
    }

    return 0;
  }
}
