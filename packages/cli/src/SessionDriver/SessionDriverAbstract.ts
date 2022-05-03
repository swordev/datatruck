import { BackupSessionEntity } from "../Entity/BackupSessionEntity";
import { BackupSessionRepositoryEntity } from "../Entity/BackupSessionRepositoryEntity";
import { BackupSessionTaskEntity } from "../Entity/BackupSessionTaskEntity";
import { RestoreSessionEntity } from "../Entity/RestoreSessionEntity";
import { RestoreSessionRepositoryEntity } from "../Entity/RestoreSessionRepositoryEntity";
import { RestoreSessionTaskEntity } from "../Entity/RestoreSessionTaskEntity";

export enum ActionEnum {
  Init,
  Start,
  Progress,
  End,
}

export enum EntityEnum {
  BackupSession,
  BackupSessionTask,
  BackupSessionRepository,
  RestoreSession,
  RestoreSessionTask,
  RestoreSessionRepository,
}

export type WriteDataType =
  | {
      action: ActionEnum;
      entity: EntityEnum.BackupSession;
      data: BackupSessionEntity;
    }
  | {
      action: ActionEnum;
      entity: EntityEnum.BackupSessionRepository;
      data: BackupSessionRepositoryEntity;
      sessionData: BackupSessionEntity;
    }
  | {
      action: ActionEnum;
      entity: EntityEnum.BackupSessionTask;
      data: BackupSessionTaskEntity;
      sessionData: BackupSessionEntity;
    }
  | {
      action: ActionEnum;
      entity: EntityEnum.RestoreSession;
      data: RestoreSessionEntity;
    }
  | {
      action: ActionEnum;
      entity: EntityEnum.RestoreSessionTask;
      data: RestoreSessionTaskEntity;
      sessionData: RestoreSessionEntity;
    }
  | {
      action: ActionEnum;
      entity: EntityEnum.RestoreSessionRepository;
      data: RestoreSessionRepositoryEntity;
      sessionData: RestoreSessionEntity;
    };

export type ReadDataType = {
  repositoryNames?: string[];
  packageNames?: string[];
  tags?: string[];
  limit?: number | null;
  verbose?: boolean;
};

export type ReadResultType = {
  id: number;
  snapshotId: string;
  creationDate: string;
  state: "started" | "ended";
  packageName: string;
  repositoryName: string;
  repositoryType: string;
  error: string | null;
};

export abstract class SessionDriverAbstract {
  constructor(
    readonly options: {
      verbose?: boolean;
    }
  ) {}
  async onInit() {}
  abstract onWrite(data: WriteDataType): Promise<void>;
  async onEnd() {}
  abstract onRead(
    data: ReadDataType,
    entity: EntityEnum
  ): Promise<ReadResultType[]>;
}
