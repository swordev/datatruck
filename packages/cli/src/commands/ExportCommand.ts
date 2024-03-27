import { ConfigAction } from "../actions/ConfigAction";
import { ExportAction, exportActionOptions } from "../actions/ExportAction";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const exportCommandOptions = {
  ...exportActionOptions,
} satisfies OptionsConfig;

export type ExportCommandOptions = InferOptions<typeof exportCommandOptions>;

export class ExportCommand extends CommandAbstract<
  typeof exportCommandOptions
> {
  static override config() {
    return {
      name: "export",
      options: exportCommandOptions,
    };
  }
  override get optionsConfig() {
    return exportCommandOptions;
  }
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);

    const restore = new ExportAction(
      config,
      {
        id: this.options.id,
        packageNames: this.options.packageNames,
        packageTaskNames: this.options.packageTaskNames,
        packageConfig: this.options.packageConfig,
        repositoryNames: this.options.repositoryNames,
        repositoryTypes: this.options.repositoryTypes,
        tags: this.options.tags,
        outPath: this.options.outPath,
        verbose: verbose > 0,
      },
      {
        tty: this.globalOptions.tty,
        progress: this.globalOptions.progress,
        streams: this.streams,
      },
    );

    const data = await restore.exec();

    if (this.globalOptions.outputFormat)
      restore
        .dataFormat(data.result, {
          verbose,
          streams: this.streams,
          errors: data.errors,
        })
        .log(this.globalOptions.outputFormat);

    return data;
  }
}
