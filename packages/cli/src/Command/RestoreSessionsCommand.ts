import { ConfigAction } from "../Action/ConfigAction";
import { RestoreSessionsAction } from "../Action/RestoreSessionsAction";
import { SqliteSessionDriver } from "../SessionDriver/SqliteSessionDriver";
import { RestoreSessionManager } from "../SessionManager/RestoreSessionManager";
import { DataFormat } from "../util/DataFormat";
import { errorColumn, resultColumn } from "../util/cli-util";
import { formatDateTime, parseStringList } from "../util/string-util";
import { If } from "../util/ts-util";
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
        description: "Package names",
        option: "-p,--package <values>",
        parser: parseStringList,
      },
      repository: {
        description: "Repository names",
        option: "-r,--repository <values>",
        parser: parseStringList,
      },
      tag: {
        description: "Tags",
        option: "--tag <values>",
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
    const configAction = new ConfigAction({
      path: this.globalOptions.config,
      verbose: verbose > 0,
    });
    const config = await configAction.exec();
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
    });

    const dataFormat = new DataFormat({
      items: await action.exec(manager),
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
      console.log(dataFormat.format(this.globalOptions.outputFormat));

    return 0;
  }
}
