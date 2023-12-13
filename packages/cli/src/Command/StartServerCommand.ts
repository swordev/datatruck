import { ConfigAction } from "../Action/ConfigAction";
import { createCronServer } from "../utils/datatruck/cron-server";
import { createDatatruckRepositoryServer } from "../utils/datatruck/repository-server";
import { CommandAbstract } from "./CommandAbstract";

export type StartServerCommandOptions<TResolved = false> = {};

export class StartServerCommand extends CommandAbstract<
  StartServerCommandOptions<false>,
  StartServerCommandOptions<true>
> {
  override optionsConfig() {
    return this.castOptionsConfig({});
  }
  override async exec() {
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const verbose = !!this.globalOptions.verbose;
    const log = config.server?.log ?? true;
    const repositoryOptions = config.server?.repository || {};

    if (repositoryOptions.enabled ?? true) {
      const server = createDatatruckRepositoryServer(repositoryOptions, {
        log,
        configPath: this.configPath,
      });
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
    const cronOptions = config.server?.cron || {};

    if (cronOptions.enabled ?? true) {
      if (typeof this.configPath !== "string")
        throw new Error(`Config path is required by cron server`);
      const server = createCronServer(cronOptions, {
        verbose,
        log,
        configPath: this.configPath,
      });
      server.start();
      console.info(`Cron server started`);
    }
    process.on("SIGINT", () => process.exit(1));
    process.on("SIGTERM", () => process.exit(1));
    await new Promise<void>(() => setInterval(() => {}, 60_000));
    return { exitCode: 0 };
  }
}
