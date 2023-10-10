import { ConfigAction } from "../Action/ConfigAction";
import { SnapshotsAction } from "../Action/SnapshotsAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { DataFormat } from "../utils/DataFormat";
import { parseStringList } from "../utils/string";
import { If, Unwrap } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";
import bytes from "bytes";

export type SnapshotsCommandOptions<TResolved = false> = {
  id?: If<TResolved, string[]>;
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  packageConfig?: boolean;
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
  SnapshotsCommandOptions<false>,
  SnapshotsCommandOptions<true>
> {
  override onOptions() {
    const groupByValues = [
      "id",
      "packageName",
      "repositoryName",
      "repositoryType",
    ];
    return this.returnsOptions({
      groupBy: {
        option: "-g,--group-by <values>",
        description: `Group by values (${groupByValues.join(", ")})`,
        parser: (v) => parseStringList(v, groupByValues) as any,
      },
      longId: {
        option: "--longId",
        description: "Show long id",
      },
      id: {
        option: "-i,--id <ids>",
        description: "Filter by identifiers",
        parser: parseStringList,
      },
      last: {
        option: "-l,--last <number>",
        description: "Filter by last snapshots",
        parser: Number,
      },
      lastMinutely: {
        option: "--lastMinutely <number>",
        description: "Filter by last minutely",
        parser: Number,
      },
      lastDaily: {
        option: "--lastDaily <number>",
        description: "Filter by last daily",
        parser: Number,
      },
      lastHourly: {
        option: "--lastHourly <number>",
        description: "Filter by last hourly",
        parser: Number,
      },
      lastMonthly: {
        option: "--lastMonthly <number>",
        description: "Filter by last monthly",
        parser: Number,
      },
      lastWeekly: {
        option: "--lastWeekly <number>",
        description: "Filter by last weekly",
        parser: Number,
      },
      lastYearly: {
        option: "--lastYearly <number>",
        description: "Filter by last yearly",
        parser: Number,
      },
      package: {
        option: "-p,--package <names>",
        description: "Filter by package names",
        parser: parseStringList,
      },
      packageTask: {
        option: "-pt,--package-task <values>",
        description: "Filter by task names",
        parser: parseStringList,
      },
      packageConfig: {
        description: "Filter by package config",
        option: "-pc,--package-config",
      },
      repository: {
        option: "-r,--repository <names>",
        description: "Filter by repository names",
        parser: parseStringList,
      },
      repositoryType: {
        option: "-rt,--repository-type <names>",
        description: "Filter by repository types",
        parser: (v) => parseStringList(v) as any,
      },
      tag: {
        description: "Filter by tags",
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
      packageConfig: this.options.packageConfig,
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
    const items = await snapshots.exec();
    const dataFormat = new DataFormat({
      json: items,
      table: {
        headers: [
          { value: "Id.", width: (this.options.longId ? 32 : 8) + 2 },
          { value: "Date", width: 23 + 2 },
          { value: "Package" },
          { value: "Task" },
          { value: "Size" },
          { value: "Repository" },
          { value: "Repository type" },
        ],
        rows: () =>
          items.map((item) => [
            this.options.longId ? item.id : item.id.slice(0, 8),
            item.date.replace("T", " ").replace("Z", ""),
            item.packageName,
            item.packageTaskName || "",
            bytes(item.size),
            item.repositoryName,
            item.repositoryType,
          ]),
      },
    });

    if (this.globalOptions.outputFormat)
      console.info(
        dataFormat.format(this.globalOptions.outputFormat, {
          tpl: {
            sids: () => items.map((i) => i.id).join(),
            ssids: () => items.map((i) => i.shortId).join(),
            pkgNames: () => items.map((i) => i.packageName).join(),
          },
        }),
      );

    return 0;
  }
}
