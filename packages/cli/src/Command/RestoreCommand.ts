import { ConfigAction } from "../Action/ConfigAction";
import { RestoreAction } from "../Action/RestoreAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { ConsoleSessionDriver } from "../SessionDriver/ConsoleSessionDriver";
import { SqliteSessionDriver } from "../SessionDriver/SqliteSessionDriver";
import { RestoreSessionManager } from "../SessionManager/RestoreSessionManager";
import { parseStringList } from "../util/string-util";
import { If } from "../util/ts-util";
import { CommandAbstract } from "./CommandAbstract";

export type RestoreCommandOptionsType<TResolved = false> = {
  id: string;
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
  tag?: If<TResolved, string[]>;
};

export class RestoreCommand extends CommandAbstract<
  RestoreCommandOptionsType<false>,
  RestoreCommandOptionsType<true>
> {
  override onOptions() {
    return this.returnsOptions({
      id: {
        description: "Filter by snapshot id",
        option: "-i,--id <id>",
        required: true,
      },
      package: {
        description: "Filter by package names",
        option: "-p,--package <values>",
        parser: parseStringList,
      },
      packageTask: {
        description: "Filter by package task names",
        option: "-pt,--package-task <values>",
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
    });
  }
  override async onExec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const restore = new RestoreAction(config, {
      snapshotId: this.options.id,
      packageNames: this.options.package,
      packageTaskNames: this.options.packageTask,
      repositoryNames: this.options.repository,
      repositoryTypes: this.options.repositoryType,
      tags: this.options.tag,
      verbose: verbose > 0,
    });

    const sessionManager = new RestoreSessionManager({
      driver: new SqliteSessionDriver({
        verbose: verbose > 1,
      }),
      altDrivers: [
        new ConsoleSessionDriver({
          verbose: verbose > 0,
        }),
      ],
      verbose: verbose > 1,
    });

    const result = await restore.exec(sessionManager);

    return result ? 0 : 1;
  }
}
