import { CleanCacheAction } from "../Action/CleanCacheAction";
import { parentTmpDir } from "../utils/temp";
import { CommandAbstract } from "./CommandAbstract";

export type CleanCacheCommandOptions<TResolved = false> = {};

export class CleanCacheCommand extends CommandAbstract<
  CleanCacheCommandOptions<false>,
  CleanCacheCommandOptions<true>
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
