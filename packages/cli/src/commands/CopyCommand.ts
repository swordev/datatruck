import { ConfigAction } from "../actions/ConfigAction";
import { CopyAction, copyActionOptions } from "../actions/CopyAction";
import { InferOptions, defineOptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const copyCommandOptions = defineOptionsConfig({
  ...copyActionOptions,
});

export type CopyCommandOptions = InferOptions<typeof copyCommandOptions>;

export class CopyCommand extends CommandAbstract<typeof copyCommandOptions> {
  static override config() {
    return {
      name: "copy",
      alias: "cp",
      options: copyCommandOptions,
    };
  }
  override get optionsConfig() {
    return copyCommandOptions;
  }
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const copy = new CopyAction(config, {
      ids: this.options.ids,
      last: this.options.last,
      packageNames: this.options.packageNames,
      packageTaskNames: this.options.packageTaskNames,
      repositoryName: this.options.repositoryName,
      repositoryNames2: this.options.repositoryNames2,
      verbose: verbose > 0,
      tty: this.globalOptions.tty,
      progress: this.globalOptions.progress,
    });

    const data = await copy.exec();

    if (this.globalOptions.outputFormat)
      copy
        .dataFormat(data.result, {
          verbose,
          streams: this.streams,
          errors: data.errors,
        })
        .log(this.globalOptions.outputFormat);

    return data;
  }
}
