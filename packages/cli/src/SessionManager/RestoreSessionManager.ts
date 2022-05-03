import { BackupSessionsActionOptionsType } from "../Action/BackupSessionsAction";
import { RestoreSessionEntity } from "../Entity/RestoreSessionEntity";
import { RestoreSessionRepositoryEntity } from "../Entity/RestoreSessionRepositoryEntity";
import { RestoreSessionTaskEntity } from "../Entity/RestoreSessionTaskEntity";
import {
  ActionEnum,
  WriteDataType,
  EntityEnum,
  SessionDriverAbstract,
} from "../SessionDriver/SessionDriverAbstract";
import { ObjectVault } from "../util/ObjectVault";

export type OptionsType = {
  driver: SessionDriverAbstract;
  altDrivers?: SessionDriverAbstract[];
  verbose?: boolean;
};

export class RestoreSessionManager {
  sessionVault = new ObjectVault<RestoreSessionEntity>();
  repositoryVault = new ObjectVault<RestoreSessionRepositoryEntity>();
  taskVault = new ObjectVault<RestoreSessionTaskEntity>();

  constructor(readonly options: OptionsType) {}

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
  async endDrivers() {
    const drivers = [this.options.driver, ...(this.options.altDrivers ?? [])];
    for (const driver of drivers) {
      await driver.onEnd();
    }
  }
  protected async alter(data: WriteDataType) {
    const drivers = [this.options.driver, ...(this.options.altDrivers ?? [])];
    for (const driver of drivers) {
      await driver.onWrite(data);
    }
    return data.data.id;
  }

  async readAll(options: BackupSessionsActionOptionsType) {
    return this.options.driver.onRead(options, EntityEnum.RestoreSession);
  }

  async init(input: Pick<RestoreSessionEntity, "packageName" | "snapshotId">) {
    return await this.alter({
      action: ActionEnum.Init,
      entity: EntityEnum.RestoreSession,
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
    input: Pick<RestoreSessionTaskEntity, "sessionId" | "taskName">
  ) {
    return await this.alter({
      action: ActionEnum.Init,
      entity: EntityEnum.RestoreSessionTask,
      sessionData: this.sessionVault.get(input.sessionId),
      data: this.taskVault.add({
        keys: [input.sessionId, input.taskName],
        handler: (id) => ({
          ...input,
          id: id,
          taskName: input.taskName,
          creationDate: new Date().toISOString(),
          state: null,
        }),
      }),
    });
  }

  async initRepository(
    input: Pick<
      RestoreSessionRepositoryEntity,
      "sessionId" | "repositoryName" | "repositoryType"
    >
  ) {
    return await this.alter({
      action: ActionEnum.Init,
      entity: EntityEnum.RestoreSessionRepository,
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

  async start(input: Pick<RestoreSessionEntity, "id">) {
    return await this.alter({
      action: ActionEnum.Start,
      entity: EntityEnum.RestoreSession,
      data: {
        ...this.sessionVault.get(input.id),
        ...input,
        startDate: new Date().toISOString(),
        state: "started",
      },
    });
  }

  async end(input: Pick<RestoreSessionEntity, "id" | "error">) {
    return await this.alter({
      action: ActionEnum.End,
      entity: EntityEnum.RestoreSession,
      data: {
        ...this.sessionVault.get(input.id),
        ...input,
        endDate: new Date().toISOString(),
        updatingDate: new Date().toISOString(),
        state: "ended",
      },
    });
  }

  async startTask(input: Pick<RestoreSessionTaskEntity, "id">) {
    const object = this.taskVault.get(input.id);
    return await this.alter({
      action: ActionEnum.Start,
      entity: EntityEnum.RestoreSessionTask,
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

  async startRepository(input: Pick<RestoreSessionRepositoryEntity, "id">) {
    const object = this.repositoryVault.get(input.id);
    return await this.alter({
      action: ActionEnum.Start,
      entity: EntityEnum.RestoreSessionRepository,
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

  async progressTask(
    input: Pick<
      RestoreSessionTaskEntity,
      | "id"
      | "progressTotal"
      | "progressCurrent"
      | "progressPercent"
      | "progressStep"
      | "progressStepPercent"
    >
  ) {
    const object = this.taskVault.get(input.id);
    return await this.alter({
      action: ActionEnum.Progress,
      entity: EntityEnum.RestoreSessionTask,
      sessionData: this.sessionVault.get(object.sessionId),
      data: {
        ...object,
        ...input,
        updatingDate: new Date().toISOString(),
      },
    });
  }

  async endTask(input: Pick<RestoreSessionTaskEntity, "id" | "error">) {
    const object = this.taskVault.get(input.id);
    return await this.alter({
      action: ActionEnum.End,
      entity: EntityEnum.RestoreSessionTask,
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

  async progressRepository(
    input: Pick<
      RestoreSessionRepositoryEntity,
      | "id"
      | "progressTotal"
      | "progressCurrent"
      | "progressPercent"
      | "progressStep"
      | "progressStepPercent"
    >
  ) {
    const object = this.repositoryVault.get(input.id);
    return await this.alter({
      action: ActionEnum.Progress,
      entity: EntityEnum.RestoreSessionRepository,
      sessionData: this.sessionVault.get(object.sessionId),
      data: {
        ...object,
        ...input,
        updatingDate: new Date().toISOString(),
      },
    });
  }

  async endRepository(
    input: Pick<RestoreSessionRepositoryEntity, "id" | "error">
  ) {
    const object = this.repositoryVault.get(input.id);
    return await this.alter({
      action: ActionEnum.End,
      entity: EntityEnum.RestoreSessionRepository,
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
