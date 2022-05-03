import { EntityDecoratorHandler } from "../Decorator/EntityDecorator";
import { BackupSessionEntity } from "../Entity/BackupSessionEntity";
import { BackupSessionRepositoryEntity } from "../Entity/BackupSessionRepositoryEntity";
import { RestoreSessionEntity } from "../Entity/RestoreSessionEntity";
import { RestoreSessionRepositoryEntity } from "../Entity/RestoreSessionRepositoryEntity";
import { logExec } from "../util/cli-util";
import { makeTableSelector } from "../util/entity-util";
import { logExecStdout } from "../util/process-util";
import {
  ActionEnum,
  WriteDataType,
  EntityEnum,
  ReadDataType,
  SessionDriverAbstract,
} from "./SessionDriverAbstract";
import { ok } from "assert";
import { homedir } from "os";
import { join } from "path";
import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";

export class SqliteSessionDriver extends SessionDriverAbstract {
  protected idMap: { [entity in EntityEnum]?: Record<number, number> } = {};
  protected db!: Database<sqlite3.Database, sqlite3.Statement>;

  override async onInit() {
    this.db = await open({
      filename:
        process.env["DATATRUCK_SQLITE_DB"] ??
        join(homedir(), "datatruck.sqlite"),
      driver: sqlite3.Database,
    });
    await this.db.migrate({
      migrationsPath: __dirname + "/../../migrations",
    });
  }

  private buildInsertStm(tableName: string, values: Record<string, any>) {
    const keys = Object.keys(values);
    const columnNames = keys.map((v) => `\`${v}\``).join(", ");
    const paramNames = keys.map((v) => `:${v}`).join(", ");
    return `INSERT INTO ${tableName} (${columnNames}) VALUES (${paramNames})`;
  }

  private buildUpdateStm(
    tableName: string,
    values: Record<string, any>,
    pkColumnName = "id"
  ) {
    const set = Object.keys(values)
      .filter((v) => v !== pkColumnName)
      .map((v) => `\`${v}\` = :${v}`)
      .join(", ");
    return `UPDATE ${tableName} SET ${set} WHERE ${pkColumnName} = :${pkColumnName}`;
  }

  private async exec<T>(query: string, cb: () => Promise<T>) {
    if (this.options.verbose) {
      logExec("query");
      logExecStdout({ data: query, lineSalt: true });
    }
    const result = await cb();

    if (this.options.verbose)
      logExecStdout({ data: JSON.stringify(result, null, 2), lineSalt: true });
    return result;
  }

  override async onRead(data: ReadDataType, type: EntityEnum) {
    const sessionMeta = EntityDecoratorHandler(
      type === EntityEnum.BackupSession
        ? BackupSessionEntity
        : RestoreSessionEntity
    );
    const sessionRepositoryMeta = EntityDecoratorHandler(
      type === EntityEnum.BackupSession
        ? BackupSessionRepositoryEntity
        : RestoreSessionRepositoryEntity
    );

    const sessionTable = makeTableSelector<
      BackupSessionEntity | RestoreSessionEntity
    >(sessionMeta.get().tableName);

    const repoTable = makeTableSelector<
      BackupSessionRepositoryEntity | RestoreSessionRepositoryEntity
    >(sessionRepositoryMeta.get().tableName);

    const where: Record<string, any> = {};

    if (data.packageNames)
      where[sessionTable("packageName")] = data.packageNames;
    if (data.repositoryNames)
      where[repoTable("repositoryName")] = data.repositoryNames;
    if (data.packageNames)
      where[sessionTable("packageName")] = data.packageNames;
    if (type === EntityEnum.BackupSession && data.tags)
      data.tags.map(
        (tag) =>
          `(',' || ${sessionTable("tags" as any)} || ',') LIKE '%,${tag},%' `
      );

    let query = `
      SELECT
        ${sessionTable("id")},
        ${sessionTable("snapshotId")},
        ${sessionTable("creationDate")},
        ${sessionTable("state")},
        ${sessionTable("packageName")},
        ${repoTable("repositoryName")},
        ${repoTable("repositoryType")},
        COALESCE(${repoTable("error")}, ${sessionTable("error")}) AS error
      FROM 
        ${sessionTable}
      LEFT JOIN ${repoTable} ON
        ${repoTable("sessionId")} = ${sessionTable("id")}
      ORDER BY
        ${sessionTable("id")} DESC
    `;

    if (data.limit) query += `LIMIT ${data.limit}`;

    return await this.exec(query, async () => await this.db.all(query));
  }

  private setMapId(entity: EntityEnum, id: number, value: number) {
    if (!this.idMap[entity]) this.idMap[entity] = {};
    const map = this.idMap[entity];
    ok(map);
    map[id] = value;
  }

  private getMapId(entity: EntityEnum, id: number) {
    const result = this.idMap[entity]?.[id];
    if (!result) throw new Error(`Entity id not found: ${entity}-${id}`);
    return result;
  }

  private static getEntityTable(entity: EntityEnum) {
    return {
      [EntityEnum.BackupSession]: "backup_session",
      [EntityEnum.BackupSessionRepository]: "backup_session_repository",
      [EntityEnum.BackupSessionTask]: "backup_session_task",
      [EntityEnum.RestoreSession]: "restore_session",
      [EntityEnum.RestoreSessionRepository]: "restore_session_repository",
      [EntityEnum.RestoreSessionTask]: "restore_session_task",
    }[entity];
  }

  private static getParentEntity(entity: EntityEnum) {
    return {
      [EntityEnum.BackupSession]: EntityEnum.BackupSession,
      [EntityEnum.BackupSessionRepository]: EntityEnum.BackupSession,
      [EntityEnum.BackupSessionTask]: EntityEnum.BackupSession,
      [EntityEnum.RestoreSession]: EntityEnum.RestoreSession,
      [EntityEnum.RestoreSessionRepository]: EntityEnum.RestoreSession,
      [EntityEnum.RestoreSessionTask]: EntityEnum.RestoreSession,
    }[entity];
  }

  override async onWrite(data: WriteDataType) {
    const tableName = SqliteSessionDriver.getEntityTable(data.entity);
    let stm: string;
    let object = data.data;
    const id = object.id;

    if (data.action === ActionEnum.Init) {
      // @ts-expect-error
      object = { ...object, id: null };
      stm = this.buildInsertStm(tableName, object);
    } else {
      object = { ...object, id: this.getMapId(data.entity, id) };
      if ("sessionId" in object) {
        const parentEntity = SqliteSessionDriver.getParentEntity(data.entity);
        object.sessionId = this.getMapId(parentEntity, object.sessionId);
      }
      stm = this.buildUpdateStm(tableName, object);
    }
    const params = Object.keys(object).reduce((result, name) => {
      result[`:${name}`] = (object as any)[name];
      return result;
    }, {} as Record<string, unknown>);

    try {
      const result = await this.exec(
        stm,
        async () => await this.db.run(stm, params)
      );

      if (
        data.action === ActionEnum.Init &&
        typeof result.lastID === "number"
      ) {
        this.setMapId(data.entity, id, result.lastID);
      }
    } catch (error) {
      console.error({
        query: stm,
        params: params,
      });
      throw new Error((error as Error).message);
    }
  }
}
