import { ConfigAction } from "../Action/ConfigAction";
import { createDatatruckServer } from "../utils/datatruck/server";
import { CommandAbstract } from "./CommandAbstract";

export type StartServerCommandOptions<TResolved = false> = {};

export class StartServerCommand extends CommandAbstract<
  StartServerCommandOptions<false>,
  StartServerCommandOptions<true>
> {
  override onOptions() {
    return this.returnsOptions({});
  }
  override async onExec() {
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const server = createDatatruckServer(config.server || {});
    const port = config.server?.listen?.port ?? 8888;
    const address = config.server?.listen?.address ?? "127.0.0.1";
    console.info(`Listening on http://${address}:${port}`);
    await new Promise((resolve, reject) => {
      server.listen(port, address);
      server.on("error", reject);
    });
    return 0;
  }
}
