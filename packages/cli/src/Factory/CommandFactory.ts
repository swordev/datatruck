import { CleanCacheActionOptionsType } from "../Action/CleanCacheAction";
import {
  BackupCommand,
  BackupCommandOptionsType,
} from "../Command/BackupCommand";
import {
  BackupSessionsCommand,
  BackupSessionsCommandOptionsType,
} from "../Command/BackupSessionsCommand";
import { CleanCacheCommand } from "../Command/CleanCacheCommand";
import { GlobalOptionsType } from "../Command/CommandAbstract";
import {
  ConfigCommand,
  ConfigCommandLogType,
  ConfigCommandOptionsType,
} from "../Command/ConfigCommand";
import {
  InitCommand,
  InitCommandLogType,
  InitCommandOptionsType,
} from "../Command/InitCommand";
import { PruneCommand, PruneCommandOptionsType } from "../Command/PruneCommand";
import {
  RestoreCommand,
  RestoreCommandOptionsType,
} from "../Command/RestoreCommand";
import {
  RestoreSessionsCommand,
  RestoreSessionsCommandOptionsType,
} from "../Command/RestoreSessionsCommand";
import {
  SnapshotsCommand,
  SnapshotsCommandLogType,
  SnapshotsCommandOptionsType,
} from "../Command/SnapshotsCommand";
import {
  StartServerCommand,
  StartServerCommandOptionsType,
} from "../Command/StartServerCommand";
import { AppError } from "../Error/AppError";

export enum CommandEnum {
  config = "config",
  init = "init",
  snapshots = "snapshots",
  prune = "prune",
  backup = "backup",
  backupSessions = "backup-sessions",
  restore = "restore",
  restoreSessions = "restore-sessions",
  cleanCache = "clean-cache",
  startServer = "start-server",
}

export type OptionsMapType = {
  [CommandEnum.config]: ConfigCommandOptionsType;
  [CommandEnum.init]: InitCommandOptionsType;
  [CommandEnum.snapshots]: SnapshotsCommandOptionsType;
  [CommandEnum.prune]: PruneCommandOptionsType;
  [CommandEnum.backup]: BackupCommandOptionsType;
  [CommandEnum.backupSessions]: BackupSessionsCommandOptionsType;
  [CommandEnum.restore]: RestoreCommandOptionsType;
  [CommandEnum.restoreSessions]: RestoreSessionsCommandOptionsType;
  [CommandEnum.cleanCache]: CleanCacheActionOptionsType;
  [CommandEnum.startServer]: StartServerCommandOptionsType;
};

export type LogMapType = {
  [CommandEnum.config]: ConfigCommandLogType;
  [CommandEnum.init]: InitCommandLogType;
  [CommandEnum.snapshots]: SnapshotsCommandLogType;
};

export function CommandFactory<TCommand extends keyof OptionsMapType>(
  type: TCommand,
  globalOptions: GlobalOptionsType<false>,
  options: OptionsMapType[TCommand],
) {
  const constructor = CommandConstructorFactory(type);
  return new constructor(globalOptions, options as any);
}

export async function exec<TCommand extends keyof OptionsMapType>(
  type: TCommand,
  globalOptions: GlobalOptionsType<false>,
  options: OptionsMapType[TCommand],
) {
  return await CommandFactory(type, globalOptions, options).onExec();
}

export function createActionInterface(
  globalOptions: GlobalOptionsType<false>,
): {
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
  } else if (type === CommandEnum.backupSessions) {
    return BackupSessionsCommand;
  } else if (type === CommandEnum.restore) {
    return RestoreCommand;
  } else if (type === CommandEnum.restoreSessions) {
    return RestoreSessionsCommand;
  } else if (type === CommandEnum.cleanCache) {
    return CleanCacheCommand;
  } else if (type === CommandEnum.startServer) {
    return StartServerCommand;
  } else {
    throw new AppError(`Invalid command type: ${type}`);
  }
}
