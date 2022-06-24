import { BackupAction } from "../Action/BackupAction";
import { ConfigAction } from "../Action/ConfigAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { AppError } from "../Error/AppError";
import { ConsoleSessionDriver } from "../SessionDriver/ConsoleSessionDriver";
import { SqliteSessionDriver } from "../SessionDriver/SqliteSessionDriver";
import { BackupSessionManager } from "../SessionManager/BackupSessionManager";
import { parseStringList } from "../util/string-util";
import { If } from "../util/ts-util";
import { CommandAbstract } from "./CommandAbstract";

export type BackupCommandOptionsType<TResolved = false> = {
  package?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
  tag?: If<TResolved, string[]>;
  dryRun?: boolean;
  date?: string;
};

export class BackupCommand extends CommandAbstract<
  BackupCommandOptionsType<false>,
  BackupCommandOptionsType<true>
> {
  override onOptions() {
    return this.returnsOptions({
      dryRun: {
        description: "Skip execution",
        option: "--dryRun",
      },
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
      repositoryType: {
        description: "Repository types",
        option: "-rt,--repository-type <values>",
        parser: (v) => parseStringList(v) as any,
      },
      tag: {
        description: "Tags",
        option: "--tag <values>",
        parser: parseStringList,
      },
      date: {
        description: "Date time (ISO)",
        option: "--date <value>",
      },
    });
  }
  override async onExec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const backup = new BackupAction(config, {
      packageNames: this.options.package,
      repositoryNames: this.options.repository,
      repositoryTypes: this.options.repositoryType,
      tags: this.options.tag,
      dryRun: this.options.dryRun,
      verbose: verbose > 0,
      date: this.options.date,
    });

    const sessionManager = new BackupSessionManager({
      driver: new SqliteSessionDriver({
        verbose: verbose > 1,
      }),
      altDrivers: [
        new ConsoleSessionDriver({
          verbose: verbose > 0,
        }),
      ],
    });

    const result = await backup.exec(sessionManager);
    if (result.errors) {
      return 1;
    } else if (!result.total) {
      throw new AppError("None package config found");
    } else {
      return 0;
    }
  }
}
