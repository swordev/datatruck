import { ConfigAction } from "../Action/ConfigAction";
import { createDatatruckRepositoryServer } from "../utils/datatruck/repository-server";
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
    const log = config.server?.log ?? true;
    const repositoryOptions = config.server?.repository || {};

    if (repositoryOptions.enabled ?? true) {
      const server = createDatatruckRepositoryServer(repositoryOptions, log);
      const port = repositoryOptions.listen?.port ?? 8888;
      const address = repositoryOptions.listen?.address ?? "127.0.0.1";
      console.info(
        `Listening datatruck repository on http://${address}:${port}`,
      );
      server.on("error", (error) => {
        console.error(`SERVER ERROR`, error);
        process.exit(1);
      });
      server.listen(port, address);
    }

    return 0;
  }
}
