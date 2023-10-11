import { CleanCacheActionOptions } from "../Action/CleanCacheAction";
import { BackupCommand, BackupCommandOptions } from "../Command/BackupCommand";
import { CleanCacheCommand } from "../Command/CleanCacheCommand";
import { GlobalOptions } from "../Command/CommandAbstract";
import {
  ConfigCommand,
  ConfigCommandResult,
  ConfigCommandOptions,
} from "../Command/ConfigCommand";
import { CopyCommand, CopyCommandOptionsType } from "../Command/CopyCommand";
import {
  InitCommand,
  InitCommandResult,
  InitCommandOptions,
} from "../Command/InitCommand";
import { PruneCommand, PruneCommandOptions } from "../Command/PruneCommand";
import {
  RestoreCommand,
  RestoreCommandOptionsType,
} from "../Command/RestoreCommand";
import {
  SnapshotsCommand,
  SnapshotsCommandResult,
  SnapshotsCommandOptions,
} from "../Command/SnapshotsCommand";
import {
  StartServerCommand,
  StartServerCommandOptions,
} from "../Command/StartServerCommand";
import { AppError } from "../Error/AppError";

export enum CommandEnum {
  config = "config",
  init = "init",
  snapshots = "snapshots",
  prune = "prune",
  backup = "backup",
  restore = "restore",
  copy = "copy",
  cleanCache = "clean-cache",
  startServer = "start-server",
}

export type OptionsMapType = {
  [CommandEnum.config]: ConfigCommandOptions;
  [CommandEnum.init]: InitCommandOptions;
  [CommandEnum.snapshots]: SnapshotsCommandOptions;
  [CommandEnum.prune]: PruneCommandOptions;
  [CommandEnum.backup]: BackupCommandOptions;
  [CommandEnum.restore]: RestoreCommandOptionsType;
  [CommandEnum.copy]: CopyCommandOptionsType;
  [CommandEnum.cleanCache]: CleanCacheActionOptions;
  [CommandEnum.startServer]: StartServerCommandOptions;
};

export type LogMapType = {
  [CommandEnum.config]: ConfigCommandResult;
  [CommandEnum.init]: InitCommandResult;
  [CommandEnum.snapshots]: SnapshotsCommandResult;
};

export function CommandFactory<TCommand extends keyof OptionsMapType>(
  type: TCommand,
  globalOptions: GlobalOptions<true>,
  options: OptionsMapType[TCommand],
) {
  const constructor = CommandConstructorFactory(type);
  return new constructor(globalOptions, options as any);
}

export async function exec<TCommand extends keyof OptionsMapType>(
  type: TCommand,
  globalOptions: GlobalOptions<true>,
  options: OptionsMapType[TCommand],
) {
  return await CommandFactory(type, globalOptions, options).onExec();
}

export function createActionInterface(globalOptions: GlobalOptions<true>): {
  [K in keyof OptionsMapType as `${K}`]: (
    options: OptionsMapType[K],
  ) => Promise<K extends keyof LogMapType ? LogMapType[K] : never>;
} {
  const object: Record<string, any> = {};
  for (const type of Object.values(CommandEnum)) {
    object[type] = async (options: any) => {
      const run = () =>
        exec(
          type as CommandEnum,
          { ...globalOptions, outputFormat: "json", verbose: 1 },
          options,
        );
      let exitCode: number;
      let log: any;
      if (["config", "init", "snapshots"].includes(type)) {
        const parsed = await runAndParse(type as keyof LogMapType, run);
        exitCode = parsed.exitCode;
        log = parsed.log;
      } else {
        exitCode = await run();
      }
      if (exitCode !== 0) throw new Error(`Invalid exit code: ${exitCode}`);
      return log;
    };
  }
  return object as any;
}

export async function runAndParse<TCommand extends keyof LogMapType>(
  type: TCommand,
  run: () => Promise<any>,
) {
  const parseLog = makeParseLog(type);
  try {
    const exitCode = await run();
    return { exitCode, log: parseLog() };
  } catch (error) {
    try {
      parseLog();
    } catch (_) {}
    throw error;
  }
}

export function makeParseLog<TCommand extends keyof LogMapType>(
  type: TCommand,
) {
  const data: unknown[] = [];
  const consoleLog = console.log;
  console.log = console.info = (...items: unknown[]) => {
    consoleLog.bind(console)(...items);
    data.push(...items);
  };
  return function parseLog() {
    console.log = console.info = consoleLog;
    return JSON.parse(data.flat().join("\n")) as LogMapType[TCommand];
  };
}

export function CommandConstructorFactory(type: CommandEnum) {
  if (type === CommandEnum.config) {
    return ConfigCommand;
  } else if (type === CommandEnum.init) {
    return InitCommand;
  } else if (type === CommandEnum.snapshots) {
    return SnapshotsCommand;
  } else if (type === CommandEnum.prune) {
    return PruneCommand;
  } else if (type === CommandEnum.backup) {
    return BackupCommand;
  } else if (type === CommandEnum.restore) {
    return RestoreCommand;
  } else if (type === CommandEnum.copy) {
    return CopyCommand;
  } else if (type === CommandEnum.cleanCache) {
    return CleanCacheCommand;
  } else if (type === CommandEnum.startServer) {
    return StartServerCommand;
  } else {
    throw new AppError(`Invalid command type: ${type}`);
  }
}
