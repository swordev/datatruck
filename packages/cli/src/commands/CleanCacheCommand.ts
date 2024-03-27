import {
  CleanCacheAction,
  cleanCacheActionOptions,
} from "../actions/CleanCacheAction";
import { formatBytes } from "../utils/bytes";
import { DataFormat } from "../utils/data-format";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const cleanCacheCommandOptions = {
  ...cleanCacheActionOptions,
} satisfies OptionsConfig;

export type CleanCacheCommandOptions = InferOptions<
  typeof cleanCacheCommandOptions
>;

export class CleanCacheCommand extends CommandAbstract<
  typeof cleanCacheCommandOptions
> {
  static override config() {
    return {
      name: "cleanCache",
      alias: "cc",
      options: cleanCacheCommandOptions,
    };
  }
  override get optionsConfig() {
    return cleanCacheCommandOptions;
  }
  override async exec() {
    const cleanCache = new CleanCacheAction({});
    const result = await cleanCache.exec();
    const dataFormat = new DataFormat({
      streams: this.streams,
      json: result,
      table: {
        headers: [
          {
            value: "Path",
          },
          {
            value: "Freed disk space",
          },
        ],
        rows: () => [[result.path, formatBytes(result.freedSize)]],
      },
    });

    await cleanCache.exec();

    if (this.globalOptions.outputFormat)
      dataFormat.log(this.globalOptions.outputFormat);

    const exitCode = result.errors.length ? 1 : 0;

    return { exitCode };
  }
}
