import { BackupCommand } from "../../commands/BackupCommand";
import { CleanCacheCommand } from "../../commands/CleanCacheCommand";
import { GlobalOptions } from "../../commands/CommandAbstract";
import { ConfigCommand } from "../../commands/ConfigCommand";
import { CopyCommand } from "../../commands/CopyCommand";
import { ExportCommand } from "../../commands/ExportCommand";
import { InitCommand } from "../../commands/InitCommand";
import { PruneCommand } from "../../commands/PruneCommand";
import { RestoreCommand } from "../../commands/RestoreCommand";
import { RunCommand } from "../../commands/RunCommand";
import { SnapshotsCommand } from "../../commands/SnapshotsCommand";
import { StartServerCommand } from "../../commands/StartServerCommand";
import { AppError } from "../error";
import { StdStreams } from "../stream";
import { Writable } from "stream";

export const datatruckCommands = {
  config: ConfigCommand,
  init: InitCommand,
  snapshots: SnapshotsCommand,
  prune: PruneCommand,
  backup: BackupCommand,
  restore: RestoreCommand,
  run: RunCommand,
  copy: CopyCommand,
  cleanCache: CleanCacheCommand,
  startServer: StartServerCommand,
  export: ExportCommand,
};

export type DatatruckCommandMap = typeof datatruckCommands;

export type InferDatatruckCommandResult<
  T extends keyof DatatruckCommandMap,
  R = Awaited<ReturnType<InstanceType<DatatruckCommandMap[T]>["exec"]>>,
> = "result" extends keyof R ? R["result"] : undefined;

export function createCommand<T extends keyof DatatruckCommandMap>(
  name: T,
  globalOptions: GlobalOptions<true>,
  options: InstanceType<DatatruckCommandMap[T]>["options"],
  streams?: Partial<StdStreams>,
  configPath?: string,
) {
  const constructor = datatruckCommands[name];
  if (!constructor) throw new AppError(`Invalid command name: ${name}`);
  return new constructor(globalOptions, options as any, streams, configPath);
}

export function createCommands(globalOptions: GlobalOptions<true>): {
  [K in keyof DatatruckCommandMap as `${K}`]: (
    options: InstanceType<DatatruckCommandMap[K]>["options"],
  ) => Promise<InferDatatruckCommandResult<K>>;
} {
  const object: Record<string, any> = {};
  for (const name in datatruckCommands) {
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
        return ["run", "export"].includes(name)
          ? undefined
          : JSON.parse(stdoutData);
      } finally {
        await end();
      }
    };
  }
  return object as any;
}
