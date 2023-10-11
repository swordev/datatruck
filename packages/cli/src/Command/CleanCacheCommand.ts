import { CleanCacheAction } from "../Action/CleanCacheAction";
import { DataFormat } from "../utils/DataFormat";
import { CommandAbstract } from "./CommandAbstract";
import bytes from "bytes";

export type CleanCacheCommandOptions<TResolved = false> = {};

export class CleanCacheCommand extends CommandAbstract<
  CleanCacheCommandOptions<false>,
  CleanCacheCommandOptions<true>
> {
  override onOptions() {
    return this.returnsOptions({});
  }
  override async onExec() {
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
        rows: () => [[result.path, bytes(result.freedSize)]],
      },
    });

    await cleanCache.exec();

    if (this.globalOptions.outputFormat)
      dataFormat.log(this.globalOptions.outputFormat);

    return result.errors.length ? 1 : 0;
  }
}
