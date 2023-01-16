import { CleanCacheAction } from "../Action/CleanCacheAction";
import { parentTmpDir } from "../utils/fs";
import { CommandAbstract } from "./CommandAbstract";

export type CleanCacheCommandOptionsType<TResolved = false> = {};

export class CleanCacheCommand extends CommandAbstract<
  CleanCacheCommandOptionsType<false>,
  CleanCacheCommandOptionsType<true>
> {
  override onOptions() {
    return this.returnsOptions({});
  }
  override async onExec() {
    const action = new CleanCacheAction({
      verbose: !!this.globalOptions.verbose,
    });
    console.info(`Cleaning ${parentTmpDir()}...`);
    await action.exec();
    return 0;
  }
}
