import { ConfigAction } from "../actions/ConfigAction";
import { logJson } from "../utils/cli";
import { createCronServer } from "../utils/datatruck/cron-server";
import { createDatatruckRepositoryServer } from "../utils/datatruck/repository-server";
import { AppError } from "../utils/error";
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
      logJson(
        "datatruck-server",
        `listening server on http://${address}:${port}`,
      );
      server.on("error", (error) => {
        console.error(`SERVER ERROR`, error);
        process.exit(1);
      });
      server.listen(port, address);
    }
    const cronOptions = config.server?.cron || {};
    const cronJobs = cronOptions.actions || [];

    if (cronOptions.enabled ?? true) {
      if (typeof this.configPath !== "string")
        throw new AppError(`Config path is required by cron server`);
      const server = createCronServer(cronOptions, {
        verbose,
        log,
        configPath: this.configPath,
      });
      server.start();
      logJson("cron-server", `server started`, {
        jobs: cronJobs.length,
      });
    }
    process.on("SIGINT", () => process.exit(1));
    process.on("SIGTERM", () => process.exit(1));
    await new Promise<void>(() => setInterval(() => {}, 60_000));
    return { exitCode: 0 };
  }
}
