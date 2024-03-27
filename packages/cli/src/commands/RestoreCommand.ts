import { ConfigAction } from "../actions/ConfigAction";
import { RestoreAction, restoreActionOptions } from "../actions/RestoreAction";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const restoreCommandOptions = {
  ...restoreActionOptions,
} satisfies OptionsConfig;

export type RestoreCommandOptions = InferOptions<typeof restoreCommandOptions>;

export class RestoreCommand extends CommandAbstract<
  typeof restoreCommandOptions
> {
  static override config() {
    return {
      name: "restore",
      alias: "r",
      options: restoreCommandOptions,
    };
  }
  override get optionsConfig() {
    return restoreCommandOptions;
  }
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const restore = new RestoreAction(
      config,
      {
        id: this.options.id,
        packageNames: this.options.packageNames,
        packageTaskNames: this.options.packageTaskNames,
        packageConfig: this.options.packageConfig,
        repositoryNames: this.options.repositoryNames,
        repositoryTypes: this.options.repositoryTypes,
        tags: this.options.tags,
        verbose: verbose > 0,
        initial: this.options.initial,
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
