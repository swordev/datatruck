import { ConfigAction } from "../Action/ConfigAction";
import { RestoreSessionsAction } from "../Action/RestoreSessionsAction";
import { SqliteSessionDriver } from "../SessionDriver/SqliteSessionDriver";
import { RestoreSessionManager } from "../SessionManager/RestoreSessionManager";
import { DataFormat } from "../utils/DataFormat";
import { errorColumn, resultColumn } from "../utils/cli";
import { formatDateTime, parseStringList } from "../utils/string";
import { If } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type RestoreSessionsCommandOptionsType<TResolved = false> = {
  package?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  tag?: If<TResolved, string[]>;
  limit?: number | null;
};

export class RestoreSessionsCommand extends CommandAbstract<
  RestoreSessionsCommandOptionsType<false>,
  RestoreSessionsCommandOptionsType<true>
> {
  override onOptions() {
    return this.returnsOptions({
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
      tag: {
        description: "Filter by tags",
        option: "-t,--tag <values>",
        parser: parseStringList,
      },
      limit: {
        description: "Limit",
        option: "-l,--limit <value>",
        defaults: 10,
        parser: Number,
      },
    });
  }
  override async onExec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const action = new RestoreSessionsAction(config, {
      packageNames: this.options.package,
      repositoryNames: this.options.repository,
      tags: this.options.tag,
      limit: this.options.limit,
      verbose: verbose > 0,
    });

    const manager = new RestoreSessionManager({
      driver: new SqliteSessionDriver({
        verbose: verbose > 1,
      }),
      progressInterval: this.globalOptions.progressInterval,
    });

    const items = await action.exec(manager);
    const dataFormat = new DataFormat({
      items,
      table: {
        labels: [
          "   ",
          "Id.",
          "Snapshot id.",
          "Date",
          "Repository",
          "Repository type",
          "Package",
          "",
        ],
        handler: (item) => [
          resultColumn(item.error, item.state),
          item.id,
          item.snapshotId.slice(0, 8),
          formatDateTime(item.creationDate),
          item.repositoryName,
          item.repositoryType,
          item.packageName,
          errorColumn(item.error, verbose),
        ],
      },
    });

    if (this.globalOptions.outputFormat)
      console.info(
        dataFormat.format(this.globalOptions.outputFormat, {
          tpl: {
            sids: () => items.map((i) => i.snapshotId).join(),
            ssids: () => items.map((i) => i.snapshotId.slice(0, 8)).join(),
            pkgNames: () => items.map((i) => i.packageName).join(),
          },
        })
      );

    return 0;
  }
}
