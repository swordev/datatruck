import { ConfigAction } from "../Action/ConfigAction";
import { PruneAction } from "../Action/PruneAction";
import { SnapshotGroupByType } from "../Action/SnapshotsAction";
import { RepositoryConfig } from "../Config/RepositoryConfig";
import { DataFormat } from "../utils/DataFormat";
import { confirm } from "../utils/cli";
import { KeepObject } from "../utils/date";
import { parseStringList } from "../utils/string";
import { If } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type PruneCommandOptions<TResolved = false> = KeepObject & {
  id?: If<TResolved, string[]>;
  longId?: boolean;
  package?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfig["type"][]>;
  tag?: If<TResolved, string[]>;
  groupBy?: If<TResolved, SnapshotGroupByType[]>;
  dryRun?: boolean;
  showAll?: boolean;
  confirm?: boolean;
};

export class PruneCommand extends CommandAbstract<
  PruneCommandOptions<false>,
  PruneCommandOptions<true>
> {
  override optionsConfig() {
    return this.castOptionsConfig({
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

  override async exec() {
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

    const result = await prune.exec();
    const dataFormat = new DataFormat({
      streams: this.streams,
      json: result,
      table: {
        headers: [
          { value: "Id.", width: (this.options.longId ? 32 : 8) + 2 },
          { value: "Date", width: 23 + 2 },
          { value: "Package" },
          { value: "Repository" },
          { value: "Repository type" },
          { value: "Exclusion reasons" },
        ],
        rows: () =>
          result.snapshots.map((item) => [
            this.options.longId ? item.id : item.id.slice(0, 8),
            item.date.replace("T", " ").replace("Z", ""),
            item.packageName,
            item.repositoryName,
            item.repositoryType,
            item.exclusionReasons?.join(", ") ?? "",
          ]),
      },
    });

    if (this.globalOptions.outputFormat)
      dataFormat.log(this.globalOptions.outputFormat);

    if (!this.options.confirm && !this.options.dryRun) {
      const answer = await confirm(
        `Delete ${result.prune}/${result.total} snapshots?`,
      );
      if (answer) await prune.confirm(result.snapshots);
    }

    return { result, exitCode: 0 };
  }
}
