import { BackupAction, backupActionOptions } from "../actions/BackupAction";
import { ConfigAction } from "../actions/ConfigAction";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const backupCommandOptions = {
  ...backupActionOptions,
} satisfies OptionsConfig;

export type BackupCommandOptions = InferOptions<typeof backupCommandOptions>;

export class BackupCommand extends CommandAbstract<
  typeof backupCommandOptions
> {
  static override config() {
    return {
      name: "backup",
      alias: "b",
      options: backupCommandOptions,
    };
  }
  override get optionsConfig() {
    return backupCommandOptions;
  }
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const backup = new BackupAction(
      config,
      {
        packageNames: this.options.packageNames,
        packageTaskNames: this.options.packageTaskNames,
        repositoryNames: this.options.repositoryNames,
        repositoryTypes: this.options.repositoryTypes,
        tags: this.options.tags,
        dryRun: this.options.dryRun,
        date: this.options.date,
        prune: this.options.prune,
        verbose: verbose > 0,
      },
      {
        progress: this.globalOptions.progress,
        streams: this.streams,
        tty: this.globalOptions.tty,
      },
    );

    const data = await backup.exec();

    if (this.globalOptions.outputFormat)
      backup
        .dataFormat(data.result, {
          verbose,
          streams: this.streams,
          errors: data.errors,
        })
        .log(this.globalOptions.outputFormat);

    return data;
  }
}
