import { BackupCommand } from "../../commands/BackupCommand";
import { CleanCacheCommand } from "../../commands/CleanCacheCommand";
import { GlobalOptions } from "../../commands/CommandAbstract";
import { ConfigCommand } from "../../commands/ConfigCommand";
import { CopyCommand } from "../../commands/CopyCommand";
import { InitCommand } from "../../commands/InitCommand";
import { PruneCommand } from "../../commands/PruneCommand";
import { RestoreCommand } from "../../commands/RestoreCommand";
import { SnapshotsCommand } from "../../commands/SnapshotsCommand";
import { StartServerCommand } from "../../commands/StartServerCommand";
import { StdStreams } from "../stream";
import { AppError } from "./error";
import { Writable } from "stream";

export const datatruckCommandMap = {
  config: ConfigCommand,
  init: InitCommand,
  snapshots: SnapshotsCommand,
  prune: PruneCommand,
  backup: BackupCommand,
  restore: RestoreCommand,
  copy: CopyCommand,
  cleanCache: CleanCacheCommand,
  startServer: StartServerCommand,
};

export type DatatruckCommandMap = typeof datatruckCommandMap;

export type InferDatatruckCommandOptions<T extends keyof DatatruckCommandMap> =
  InstanceType<DatatruckCommandMap[T]>["inputOptions"];

export type InferDatatruckCommandResult<
  T extends keyof DatatruckCommandMap,
  R = Awaited<ReturnType<InstanceType<DatatruckCommandMap[T]>["exec"]>>,
> = "result" extends keyof R ? R["result"] : undefined;

export function createCommand<T extends keyof DatatruckCommandMap>(
  name: T,
  globalOptions: GlobalOptions<true>,
  options: InferDatatruckCommandOptions<T>,
  streams?: Partial<StdStreams>,
  configPath?: string,
) {
  const constructor = datatruckCommandMap[name];
  if (!constructor) throw new AppError(`Invalid command name: ${name}`);
  return new constructor(globalOptions, options as any, streams, configPath);
}

export function createCommands(globalOptions: GlobalOptions<true>): {
  [K in keyof DatatruckCommandMap as `${K}`]: (
    options: InferDatatruckCommandOptions<K>,
  ) => Promise<InferDatatruckCommandResult<K>>;
} {
  const object: Record<string, any> = {};
  for (const name in datatruckCommandMap) {
    object[name as any] = async (options: any) => {
      let stdoutData = "";
      const stdout = new Writable({
        write(chunk, encoding, callback) {
          stdoutData += chunk.toString();
          process.stdout.write(chunk, encoding, callback);
        },
      }).on("data", (chunk) => (stdoutData += chunk.toString()));
      const end = () =>
        !stdout.closed &&
        new Promise<void>((resolve) => stdout.end().on("close", resolve));
      try {
        const command = createCommand(
          name as any,
          { ...globalOptions, outputFormat: "json", verbose: 1 },
          options,
          { stdout },
        );
        const { exitCode } = await command.exec();
        if (exitCode !== 0) throw new Error(`Invalid exit code: ${exitCode}`);
        await end();
        return JSON.parse(stdoutData);
      } finally {
        await end();
      }
    };
  }
  return object as any;
}
