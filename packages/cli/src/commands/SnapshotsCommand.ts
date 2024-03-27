import { ConfigAction } from "../actions/ConfigAction";
import {
  SnapshotsAction,
  snapshotsActionOptions,
} from "../actions/SnapshotsAction";
import { formatBytes } from "../utils/bytes";
import { DataFormat } from "../utils/data-format";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const snapshotsCommandOptions = {
  ...snapshotsActionOptions,
  longId: {
    description: "Show long id",
  },
} satisfies OptionsConfig;

export type SnapshotsCommandOptions = InferOptions<
  typeof snapshotsCommandOptions
>;

export class SnapshotsCommand extends CommandAbstract<
  typeof snapshotsCommandOptions
> {
  static override config() {
    return {
      name: "snapshots",
      alias: "s",
      options: snapshotsCommandOptions,
    };
  }
  override get optionsConfig() {
    return snapshotsCommandOptions;
  }
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const snapshots = new SnapshotsAction(config, {
      ids: this.options.ids,
      hostnames: this.options.hostnames,
      packageNames: this.options.packageNames,
      packageTaskNames: this.options.packageTaskNames,
      packageConfig: this.options.packageConfig,
      repositoryNames: this.options.repositoryNames,
      repositoryTypes: this.options.repositoryTypes,
      last: this.options.last,
      lastMinutely: this.options.lastMinutely,
      lastHourly: this.options.lastHourly,
      lastDaily: this.options.lastDaily,
      lastWeekly: this.options.lastWeekly,
      lastMonthly: this.options.lastMonthly,
      lastYearly: this.options.lastYearly,
      groupBy: this.options.groupBy,
      verbose: verbose > 0,
      tags: this.options.tags,
    });
    const result = await snapshots.exec();
    const dataFormat = new DataFormat({
      streams: this.streams,
      json: result,
      table: {
        headers: [
          { value: "Id.", width: (this.options.longId ? 32 : 8) + 2 },
          { value: "Date", width: 23 + 2 },
          { value: "Host" },
          { value: "Package" },
          { value: "Task" },
          { value: "Size" },
          { value: "Repository" },
          { value: "Repository type" },
        ],
        rows: () =>
          result.map((item) => [
            this.options.longId ? item.id : item.id.slice(0, 8),
            item.date.replace("T", " ").replace("Z", ""),
            item.hostname,
            item.packageName,
            item.packageTaskName || "",
            formatBytes(item.size),
            item.repositoryName,
            item.repositoryType,
          ]),
      },
    });

    if (this.globalOptions.outputFormat)
      dataFormat.log(this.globalOptions.outputFormat, {
        tpl: {
          sids: () => result.map((i) => i.id).join(),
          ssids: () => result.map((i) => i.shortId).join(),
          pkgNames: () => result.map((i) => i.packageName).join(),
        },
      });

    return { result, exitCode: 0 };
  }
}
