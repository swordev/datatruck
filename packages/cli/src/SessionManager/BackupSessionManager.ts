import { BackupSessionsActionOptionsType } from "../Action/BackupSessionsAction";
import { BackupSessionEntity } from "../Entity/BackupSessionEntity";
import { BackupSessionRepositoryEntity } from "../Entity/BackupSessionRepositoryEntity";
import { BackupSessionTaskEntity } from "../Entity/BackupSessionTaskEntity";
import {
  ActionEnum,
  WriteDataType,
  EntityEnum,
} from "../SessionDriver/SessionDriverAbstract";
import { ObjectVault } from "../utils/ObjectVault";
import { Progress } from "../utils/progress";
import SessionManagerAbstract from "./SessionManagerAbstract";

export class BackupSessionManager extends SessionManagerAbstract {
  sessionVault = new ObjectVault<BackupSessionEntity>();
  taskVault = new ObjectVault<BackupSessionTaskEntity>();
  repositoryVault = new ObjectVault<BackupSessionRepositoryEntity>();

  findId(data: { packageName: string }) {
    return this.sessionVault.getId([data.packageName]);
  }

  findTaskId(data: { packageName: string; taskName: string }) {
    const sessionId = this.findId(data);
    return this.taskVault.getId([sessionId, data.taskName]);
  }

  findRepositoryId(data: { packageName: string; repositoryName: string }) {
    const sessionId = this.findId(data);
    return this.repositoryVault.getId([sessionId, data.repositoryName]);
  }

  async initDrivers() {
    const drivers = [this.options.driver, ...(this.options.altDrivers ?? [])];
    for (const driver of drivers) {
      await driver.onInit();
    }
  }

  async endDrivers(data?: Record<string, any>) {
    const drivers = [this.options.driver, ...(this.options.altDrivers ?? [])];
    this.stopDelayedProgress();
    for (const driver of drivers) {
      await driver.onEnd(data);
    }
  }

  protected async alter(data: WriteDataType) {
    const drivers = [this.options.driver, ...(this.options.altDrivers ?? [])];
    const write = async () => {
      for (const driver of drivers) {
        await driver.onWrite(data);
      }
    };
    if (
      data.action === ActionEnum.Progress &&
      !this.checkProgress(data.data.progress?.relative?.description)
    ) {
      this.delayProgress(write);
    } else {
      this.stopDelayedProgress();
      await write();
    }

    return data.data.id;
  }

  async readAll(options: BackupSessionsActionOptionsType) {
    return this.options.driver?.onRead(options, EntityEnum.BackupSession);
  }

  async init(
    input: Pick<BackupSessionEntity, "packageName" | "snapshotId" | "tags">
  ) {
    return await this.alter({
      action: ActionEnum.Init,
      entity: EntityEnum.BackupSession,
      data: this.sessionVault.add({
        keys: [input.packageName],
        handler: (id) => ({
          ...input,
          id: id,
          creationDate: new Date().toISOString(),
          state: null,
        }),
      }),
    });
  }

  async initTask(
    input: Pick<BackupSessionTaskEntity, "sessionId" | "taskName">
  ) {
    return await this.alter({
      action: ActionEnum.Init,
      entity: EntityEnum.BackupSessionTask,
      sessionData: this.sessionVault.get(input.sessionId),
      data: this.taskVault.add({
        keys: [input.sessionId, input.taskName],
        handler: (id) => ({
          ...input,
          id: id,
          creationDate: new Date().toISOString(),
          state: null,
        }),
      }),
    });
  }

  async initRepository(
    input: Pick<
      BackupSessionRepositoryEntity,
      "repositoryName" | "sessionId" | "repositoryType"
    >
  ) {
    return await this.alter({
      action: ActionEnum.Init,
      entity: EntityEnum.BackupSessionRepository,
      sessionData: this.sessionVault.get(input.sessionId),
      data: this.repositoryVault.add({
        keys: [input.sessionId, input.repositoryName],
        handler: (id) => ({
          ...input,
          id: id,
          creationDate: new Date().toISOString(),
          state: null,
        }),
      }),
    });
  }

  async start(input: Pick<BackupSessionEntity, "id">) {
    return await this.alter({
      action: ActionEnum.Start,
      entity: EntityEnum.BackupSession,
      data: {
        ...this.sessionVault.get(input.id),
        ...input,
        startDate: new Date().toISOString(),
        updatingDate: new Date().toISOString(),
        state: "started",
      },
    });
  }

  async end(input: Pick<BackupSessionEntity, "id" | "error">) {
    return await this.alter({
      action: ActionEnum.End,
      entity: EntityEnum.BackupSession,
      data: {
        ...this.sessionVault.get(input.id),
        ...input,
        endDate: new Date().toISOString(),
        updatingDate: new Date().toISOString(),
        state: "ended",
      },
    });
  }

  async startTask(input: Pick<BackupSessionTaskEntity, "id">) {
    const object = this.taskVault.get(input.id);
    return await this.alter({
      action: ActionEnum.Start,
      entity: EntityEnum.BackupSessionTask,
      sessionData: this.sessionVault.get(object.sessionId),
      data: {
        ...object,
        ...input,
        state: "started",
        startDate: new Date().toISOString(),
        updatingDate: new Date().toISOString(),
      },
    });
  }
  async progressTask(input: { id: number; progress: Progress }) {
    const object = this.taskVault.get(input.id);
    return await this.alter({
      action: ActionEnum.Progress,
      entity: EntityEnum.BackupSessionTask,
      sessionData: this.sessionVault.get(object.sessionId),
      data: {
        ...object,
        ...input,
        updatingDate: new Date().toISOString(),
      },
    });
  }

  async endTask(input: Pick<BackupSessionTaskEntity, "id" | "error">) {
    const object = this.taskVault.get(input.id);
    return await this.alter({
      action: ActionEnum.End,
      entity: EntityEnum.BackupSessionTask,
      sessionData: this.sessionVault.get(object.sessionId),
      data: {
        ...object,
        ...input,
        endDate: new Date().toISOString(),
        updatingDate: new Date().toISOString(),
        state: "ended",
      },
    });
  }

  async startRepository(input: Pick<BackupSessionRepositoryEntity, "id">) {
    const object = this.repositoryVault.get(input.id);
    return await this.alter({
      action: ActionEnum.Start,
      entity: EntityEnum.BackupSessionRepository,
      sessionData: this.sessionVault.get(object.sessionId),
      data: {
        ...object,
        ...input,
        startDate: new Date().toISOString(),
        updatingDate: new Date().toISOString(),
        state: "started",
      },
    });
  }

  async progressRepository(input: { id: number; progress: Progress }) {
    const object = this.repositoryVault.get(input.id);
    return await this.alter({
      action: ActionEnum.Progress,
      entity: EntityEnum.BackupSessionRepository,
      sessionData: this.sessionVault.get(object.sessionId),
      data: {
        ...object,
        ...input,
        updatingDate: new Date().toISOString(),
      },
    });
  }

  async endRepository(
    input: Pick<BackupSessionRepositoryEntity, "id" | "error">
  ) {
    const object = this.repositoryVault.get(input.id);
    return await this.alter({
      action: ActionEnum.End,
      entity: EntityEnum.BackupSessionRepository,
      sessionData: this.sessionVault.get(object.sessionId),
      data: {
        ...object,
        ...input,
        endDate: new Date().toISOString(),
        updatingDate: new Date().toISOString(),
        state: "ended",
      },
    });
  }
}
