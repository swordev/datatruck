import { BackupAction } from "../Action/BackupAction";
import { ConfigAction } from "../Action/ConfigAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { DataFormat } from "../utils/DataFormat";
import { errorColumn, resultColumn } from "../utils/cli";
import { duration } from "../utils/date";
import { parseStringList } from "../utils/string";
import { If, Unwrap } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";
import chalk from "chalk";

export type BackupCommandOptions<TResolved = false> = {
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
  tag?: If<TResolved, string[]>;
  dryRun?: boolean;
  date?: string;
};

export type BackupCommandResult = Unwrap<BackupAction["exec"]>;

export class BackupCommand extends CommandAbstract<
  BackupCommandOptions<false>,
  BackupCommandOptions<true>
> {
  override onOptions() {
    return this.returnsOptions({
      dryRun: {
        description: "Skip execution",
        option: "--dryRun",
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
      packageTaskNames: this.options.packageTask,
      repositoryNames: this.options.repository,
      repositoryTypes: this.options.repositoryType,
      tags: this.options.tag,
      dryRun: this.options.dryRun,
      verbose: verbose > 0,
      date: this.options.date,
      tty: this.globalOptions.tty,
      progress: this.globalOptions.progress,
      progressInterval: this.globalOptions.progressInterval,
      streams: this.streams,
    });

    const result = await backup.exec();

    if (this.globalOptions.outputFormat)
      backup
        .dataFormat(result, { streams: this.streams, verbose })
        .log(this.globalOptions.outputFormat);

    return result.some((item) => item.error) ? 1 : 0;
  }
}
