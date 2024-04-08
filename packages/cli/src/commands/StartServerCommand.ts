import { ConfigAction } from "../actions/ConfigAction";
import { logJson } from "../utils/cli";
import { createCronServer } from "../utils/datatruck/cron-server";
import { createDatatruckRepositoryServer } from "../utils/datatruck/repository-server";
import { AppError } from "../utils/error";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const startServerOptions = {} satisfies OptionsConfig;

export type StartServerOptions = InferOptions<typeof startServerOptions>;

export class StartServerCommand extends CommandAbstract<
  typeof startServerOptions
> {
  static override config() {
    return {
      name: "startServer",
      alias: "start",
      options: startServerOptions,
    };
  }
  override get optionsConfig() {
    return startServerOptions;
  }
  override async exec() {
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const configPath = this.configPath;
    const verbose = !!this.globalOptions.verbose;
    const repositoryOptions = config.server?.repository || {};

    if (repositoryOptions.enabled ?? true) {
      const server = createDatatruckRepositoryServer(repositoryOptions, {
        configPath,
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

    if (cronOptions.enabled ?? true) {
      if (typeof configPath !== "string")
        throw new AppError(`Config path is required by cron server`);
      const server = await createCronServer({
        configPath,
        verbose,
        log: config.server?.cron?.log,
      });
      server.start();
    }

    const exitCode = await new Promise<number>((resolve) => {
      process.on("SIGINT", () => resolve(1)).on("SIGTERM", () => resolve(1));
    });

    return { exitCode };
  }
}
