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

export function makeParseLog<TCommand extends keyof LogMapType>(
  type: TCommand,
) {
  const data: unknown[] = [];
  const consoleLog = console.log;
  console.log = console.info = (...items: unknown[]) => {
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
  } else {
    throw new AppError(`Invalid command type: ${type}`);
  }
}
