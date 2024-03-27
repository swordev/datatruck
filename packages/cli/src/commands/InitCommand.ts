import { ConfigAction } from "../actions/ConfigAction";
import { InitAction, initActionOptions } from "../actions/InitAction";
import { renderError, renderResult } from "../utils/cli";
import { DataFormat } from "../utils/data-format";
import { AppError } from "../utils/error";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const initCommandOptions = {
  ...initActionOptions,
} satisfies OptionsConfig;

export type InitCommandOptions = InferOptions<typeof initCommandOptions>;

export class InitCommand extends CommandAbstract<typeof initCommandOptions> {
  static override config() {
    return {
      name: "init",
      alias: "i",
      options: initCommandOptions,
    };
  }
  override get optionsConfig() {
    return initCommandOptions;
  }
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const init = new InitAction(config, {
      repositoryNames: this.options.repositoryNames,
      repositoryTypes: this.options.repositoryTypes,
      verbose: verbose > 0,
    });
    const result = await init.exec();
    const exitCode = result.some((item) => item.error) ? 1 : 0;
    const errors = result
      .filter(
        (item) => item.error && (verbose || !(item.error instanceof AppError)),
      )
      .map(({ error }) => error) as Error[];
    const dataFormat = new DataFormat({
      streams: this.streams,
      json: result,
      table: {
        headers: [
          { value: "", width: 3 },
          { value: "Repository name" },
          { value: "Repository type" },
          { value: "Repository source" },
          { value: "Error", width: 50 },
        ],
        rows: () =>
          result.map((item) => [
            renderResult(item.error),
            item.repositoryName,
            item.repositoryType,
            item.repositorySource,
            renderError(item.error, errors.indexOf(item.error!)),
          ]),
      },
    });

    if (this.globalOptions.outputFormat)
      dataFormat.log(this.globalOptions.outputFormat);

    return { result, exitCode, errors };
  }
}
