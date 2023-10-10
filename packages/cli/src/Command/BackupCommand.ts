import { BackupAction } from "../Action/BackupAction";
import { ConfigAction } from "../Action/ConfigAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { DataFormat } from "../utils/DataFormat";
import { errorColumn, resultColumn } from "../utils/cli";
import { duration } from "../utils/date";
import { parseStringList } from "../utils/string";
import { If } from "../utils/ts";
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
    });

    const list = await backup.exec();
    const report = await list.run();
    const dataFormat = new DataFormat({
      json: report,
      table: {
        headers: [
          {
            value: "",
            width: 3,
          },
          {
            value: "Id.",
            width: 10,
          },
          {
            value: "Package",
          },
          {
            value: "Repository",
          },
          {
            value: "Duration",
            width: 10,
          },
          {
            value: "Error",
            width: 50,
          },
        ],
        rows: () => [
          [
            resultColumn(
              report.packages.some(
                (pkg) => pkg.error || pkg.snapshots.some((s) => s.error),
              ),
            ),
            report.snapshotId,
            chalk.gray(`(${report.packages.length} packages)`),
            chalk.gray(
              `(${report.packages.reduce(
                (t, pkg) => t + pkg.snapshots.length,
                0,
              )} repositories)`,
            ),
            chalk.gray(duration(report.duration)),
            "",
          ],
          ...report.packages.flatMap((pkg) => [
            [
              resultColumn(pkg.error || pkg.snapshots.some((s) => s.error)),
              "",
              pkg.name,
              chalk.gray(`(${pkg.snapshots.length} repositories)`),
              chalk.gray(
                duration(pkg.snapshots.reduce((t, v) => t + v.duration, 0)),
              ),
              errorColumn(pkg.error, verbose),
            ],
            ...pkg.snapshots.map((s) => [
              resultColumn(s.error),
              "",
              "",
              s.mirrorRepository
                ? `${s.repositoryName} (mirror)`
                : s.repositoryName,
              duration(s.duration),
              errorColumn(s.error, verbose),
            ]),
          ]),
        ],
      },
    });

    if (this.globalOptions.outputFormat)
      console.info(dataFormat.format(this.globalOptions.outputFormat));

    return list.errors.length ? 1 : 0;
  }
}
