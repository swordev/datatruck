import { CleanCacheAction } from "../Action/CleanCacheAction";
import { DataFormat } from "../utils/DataFormat";
import { formatBytes } from "../utils/bytes";
import { CommandAbstract } from "./CommandAbstract";

export type CleanCacheCommandOptions<TResolved = false> = {};

export class CleanCacheCommand extends CommandAbstract<
  CleanCacheCommandOptions<false>,
  CleanCacheCommandOptions<true>
> {
  override optionsConfig() {
    return this.castOptionsConfig({});
  }
  override async exec() {
    const cleanCache = new CleanCacheAction({
      verbose: !!this.globalOptions.verbose,
    });
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
