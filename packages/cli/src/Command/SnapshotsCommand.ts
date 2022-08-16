import { ConfigAction } from "../Action/ConfigAction";
import { SnapshotsAction } from "../Action/SnapshotsAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { DataFormat } from "../util/DataFormat";
import { parseStringList } from "../util/string-util";
import { If, Unwrap } from "../util/ts-util";
import { CommandAbstract } from "./CommandAbstract";

export type SnapshotsCommandOptionsType<TResolved = false> = {
  id?: If<TResolved, string[]>;
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
  longId?: boolean;
  last?: If<TResolved, number>;
  lastMinutely?: If<TResolved, number>;
  lastHourly?: If<TResolved, number>;
  lastDaily?: If<TResolved, number>;
  lastWeekly?: If<TResolved, number>;
  lastMonthly?: If<TResolved, number>;
  lastYearly?: If<TResolved, number>;
  groupBy?: If<TResolved, SnapshotsAction["options"]["groupBy"]>;
  tag?: If<TResolved, string[]>;
};

export type SnapshotsCommandLogType = Unwrap<SnapshotsAction["exec"]>;

export class SnapshotsCommand extends CommandAbstract<
  SnapshotsCommandOptionsType<false>,
  SnapshotsCommandOptionsType<true>
> {
  override onOptions() {
    const groupByValues = ["packageName", "repositoryName", "repositoryType"];
    return this.returnsOptions({
      groupBy: {
        option: "-g,--group-by <values>",
        description: `Group by values (${groupByValues.join(", ")})`,
        parser: (v) => parseStringList(v, groupByValues) as any,
      },
      id: {
        option: "-i,--id <ids>",
        description: "Snapshot identifiers",
        parser: parseStringList,
      },
      last: {
        option: "-l,--last <number>",
        description: "Last snapshots",
        parser: Number,
      },
      lastMinutely: {
        option: "--lastMinutely <number>",
        description: "Last minutely snapshots",
        parser: Number,
      },
      lastDaily: {
        option: "--lastDaily <number>",
        description: "Last daily snapshots",
        parser: Number,
      },
      lastHourly: {
        option: "--lastHourly <number>",
        description: "Last hourly snapshots",
        parser: Number,
      },
      lastMonthly: {
        option: "--lastMonthly <number>",
        description: "Last monthly snapshots",
        parser: Number,
      },
      lastWeekly: {
        option: "--lastWeekly <number>",
        description: "Last weekly snapshots",
        parser: Number,
      },
      lastYearly: {
        option: "--lastYearly <number>",
        description: "Last yearly snapshots",
        parser: Number,
      },
      longId: {
        option: "--longId",
        description: "Show long id",
      },
      package: {
        option: "-p,--package <names>",
        description: "Package names",
        parser: parseStringList,
      },
      packageTask: {
        description: "Package task names",
        option: "-pt,--package-task <values>",
        parser: parseStringList,
      },
      repository: {
        option: "-r,--repository <names>",
        description: "Repository names",
        parser: parseStringList,
      },
      repositoryType: {
        option: "-t,--repositoryType <names>",
        description: "Repository types",
        parser: (v) => parseStringList(v) as any,
      },
      tag: {
        description: "Tags",
        option: "-t,--tag <values>",
        parser: parseStringList,
      },
    });
  }
  override async onExec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const snapshots = new SnapshotsAction(config, {
      ids: this.options.id,
      packageNames: this.options.package,
      packageTaskNames: this.options.packageTask,
      repositoryNames: this.options.repository,
      repositoryTypes: this.options.repositoryType,
      last: this.options.last,
      lastMinutely: this.options.lastMinutely,
      lastHourly: this.options.lastHourly,
      lastDaily: this.options.lastDaily,
      lastWeekly: this.options.lastWeekly,
      lastMonthly: this.options.lastMonthly,
      lastYearly: this.options.lastYearly,
      groupBy: this.options.groupBy,
      verbose: verbose > 0,
      tags: this.options.tag,
    });
    const dataFormat = new DataFormat({
      items: await snapshots.exec(),
      table: {
        labels: [
          "Id.",
          "Date",
          "Package",
          "Task",
          "Repository",
          "Repository type",
        ],
        handler: (item) => [
          this.options.longId ? item.id : item.id.slice(0, 8),
          item.date.replace("T", " ").replace("Z", ""),
          item.packageName,
          item.packageTaskName || "",
          item.repositoryName,
          item.repositoryType,
        ],
      },
    });

    if (this.globalOptions.outputFormat)
      console.info(dataFormat.format(this.globalOptions.outputFormat));

    return 0;
  }
}
