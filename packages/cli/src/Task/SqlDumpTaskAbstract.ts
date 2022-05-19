import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../util/cli-util";
import { resolveDatabaseName } from "../util/datatruck/config-util";
import { checkDir } from "../util/fs-util";
import { progressPercent } from "../util/math-util";
import { exec } from "../util/process-util";
import { BackupDataType, RestoreDataType, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { mkdir, readdir, readFile } from "fs/promises";
import { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { join } from "path";

export type TargetDatabaseType = {
  name: string;
  charset?: string;
  collate?: string;
};

export type SqlDumpTaskConfigType = {
  password: string | { path: string };
  hostname: string;
  port?: number;
  database: string;
  username: string;
  targetDatabase?: TargetDatabaseType;
  includeTables?: string[];
  excludeTables?: string[];
  oneFileByTable?: boolean;
};

export const sqlDumpTaskDefinition: JSONSchema7 = {
  type: "object",
  required: ["password", "hostname", "username", "database"],
  properties: {
    password: {
      anyOf: [
        {
          type: "string",
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: { type: "string" },
          },
        },
      ],
    },
    hostname: { type: "string" },
    port: { type: "integer" },
    username: { type: "string" },
    database: { type: "string" },
    targetDatabase: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        charset: { type: "string" },
        collate: { type: "string" },
      },
    },
    includeTables: makeRef(DefinitionEnum.stringListUtil),
    excludeTables: makeRef(DefinitionEnum.stringListUtil),
    oneFileByTable: { type: "boolean" },
  },
};

export abstract class SqlDumpTaskAbstract<
  TConfig extends SqlDumpTaskConfigType
> extends TaskAbstract<TConfig> {
  protected verbose?: boolean;
  async fetchPassword() {
    if (typeof this.config.password === "string") return this.config.password;
    if (this.config.password)
      return (await readFile(this.config.password.path)).toString();
    return null;
  }

  async fetchValues(query: string) {
    const result = await this.onExecQuery(query);
    return result.stdout.split(/\r?\n/).reduce((result, value) => {
      value = value.trim();
      if (value.length) result.push(value);
      return result;
    }, [] as string[]);
  }

  abstract onCreateDatabase(database: TargetDatabaseType): Promise<void>;
  abstract onDatabaseIsEmpty(databaseName: string): Promise<boolean>;
  abstract onFetchTableNames(): Promise<string[]>;
  abstract onExecQuery(query: string): ReturnType<typeof exec>;
  abstract onExport(tableNames: string[], output: string): Promise<void>;
  abstract onImport(path: string, database: string): Promise<void>;

  async fetchTableNames() {
    const tableNames = await this.onFetchTableNames();
    const config = this.config;
    return tableNames.filter((tableName) => {
      if (config.includeTables && !isMatch(tableName, config.includeTables))
        return false;
      if (config.excludeTables && isMatch(tableName, config.excludeTables))
        return false;
      return true;
    });
  }

  override async onBackup(data: BackupDataType): Promise<void> {
    this.verbose = data.options.verbose;
    const outputPath = data.package.path;
    const tableNames = await this.fetchTableNames();

    ok(typeof outputPath === "string");

    if (!(await checkDir(outputPath)))
      await mkdir(outputPath, { recursive: true });

    if (!this.config.oneFileByTable) {
      const outPath = join(outputPath, this.config.database) + ".database.sql";
      await this.onExport(tableNames, outPath);
    } else {
      let current = 0;
      for (const tableName of tableNames) {
        data.onProgress({
          total: tableNames.length,
          current: current,
          percent: progressPercent(tableNames.length, current),
          step: tableName,
        });
        current++;
        const outPath = join(outputPath, tableName) + ".table.sql";
        await this.onExport([tableName], outPath);
      }
    }
  }

  override async onRestore(data: RestoreDataType) {
    const restorePath = data.package.restorePath;
    this.verbose = data.options.verbose;

    ok(typeof restorePath === "string");

    const database: TargetDatabaseType = {
      name: resolveDatabaseName(this.config.database, {
        packageName: data.package.name,
        snapshotId: data.options.snapshotId,
        snapshotDate: data.snapshot.date,
        action: "restore",
        database: undefined,
      }),
    };

    if (this.config.targetDatabase) {
      database.name = resolveDatabaseName(this.config.targetDatabase.name, {
        packageName: data.package.name,
        snapshotId: data.options.snapshotId,
        snapshotDate: data.snapshot.date,
        action: "restore",
        database: database.name,
      });
    }

    if (!(await this.onDatabaseIsEmpty(database.name)))
      throw new AppError(`Target database is not empty: ${database.name}`);

    await this.onCreateDatabase(database);

    if (this.verbose) logExec("readdir", [restorePath]);

    const files = (await readdir(restorePath)).filter((name) =>
      /\.sql$/i.test(name)
    );
    let current = 0;
    for (const file of files) {
      const path = join(restorePath, file);
      data.onProgress({
        total: files.length,
        current: current,
        percent: progressPercent(files.length, current),
        step: file,
      });
      current++;
      await this.onImport(path, database.name);
    }
  }
}
