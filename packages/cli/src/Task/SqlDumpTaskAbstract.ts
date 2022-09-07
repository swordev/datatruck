import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../util/cli-util";
import { resolveDatabaseName } from "../util/datatruck/config-util";
import { checkDir, readDir } from "../util/fs-util";
import { progressPercent } from "../util/math-util";
import { exec } from "../util/process-util";
import { BackupDataType, RestoreDataType, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { mkdir, readFile } from "fs/promises";
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
  storedPrograms?: boolean;
  targetDatabase?: TargetDatabaseType;
  includeTables?: string[];
  excludeTables?: string[];
  oneFileByTable?: boolean;
};

export const sqlDumpTaskDefinition: JSONSchema7 = {
  type: "object",
  required: ["password", "hostname", "username", "database"],
  additionalProperties: false,
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
    storedPrograms: { type: "boolean" },
    includeTables: makeRef(DefinitionEnum.stringListUtil),
    excludeTables: makeRef(DefinitionEnum.stringListUtil),
    oneFileByTable: { type: "boolean" },
  },
};

type SqlFile = {
  fileName: string;
  database?: string;
  table?: string;
};

function serializeSqlFile(input: Omit<SqlFile, "fileName">) {
  if (input.database && input.table) {
    return `${input.database}.${input.table}.table.sql`;
  } else if (input.database && !input.table) {
    return `${input.database}.database.sql`;
  } else if (!input.database && input.table) {
    return `${input.table}.table.sql`;
  } else {
    throw new AppError(`Invalid sql file input: ${JSON.stringify(input)}`);
  }
}

function parseSqlFile(fileName: string): SqlFile | undefined {
  if (!fileName.endsWith(".sql")) return;
  const regex = /^(.+)\.(table|database)\.sql$/;
  const matches = regex.exec(fileName);
  if (!matches) return { fileName };
  const [, name, type] = matches;
  const lastName = name.split(".").pop()!;
  if (type === "table") {
    return { fileName, table: lastName };
  } else if (type === "database") {
    return { fileName, database: lastName };
  } else {
    throw new Error(`Invalid sql file type: ${type}`);
  }
}

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
  abstract onFetchTableNames(database: string): Promise<string[]>;
  abstract onExecQuery(query: string): ReturnType<typeof exec>;
  abstract onExportTables(
    tableNames: string[],
    output: string,
    onProgress: (data: { totalBytes: number }) => void
  ): Promise<void>;
  abstract onExportStoredPrograms(output: string): Promise<void>;
  abstract onImport(path: string, database: string): Promise<void>;

  override async onBackup(data: BackupDataType): Promise<void> {
    this.verbose = data.options.verbose;
    const config = this.config;
    const outputPath = data.package.path;
    const allTableNames = await this.onFetchTableNames(this.config.database);
    const tableNames = allTableNames.filter((tableName) => {
      if (config.includeTables && !isMatch(tableName, config.includeTables))
        return false;
      if (config.excludeTables && isMatch(tableName, config.excludeTables))
        return false;
      return true;
    });

    ok(typeof outputPath === "string");

    if (!(await checkDir(outputPath)))
      await mkdir(outputPath, { recursive: true });

    if (!this.config.oneFileByTable) {
      const outPath = join(
        outputPath,
        serializeSqlFile({ database: this.config.database })
      );
      data.onProgress({
        relative: {
          description: "Exporting",
        },
      });
      await this.onExportTables(tableNames, outPath, async (progress) => {
        await data.onProgress({
          absolute: {
            description: "Exporting in single file",
            current: progress.totalBytes,
            format: "size",
          },
        });
      });
    } else {
      let current = 0;
      for (const tableName of tableNames) {
        await data.onProgress({
          relative: {
            description: "Exporting",
            payload: tableName,
          },
          absolute: {
            total: tableNames.length,
            current: current,
            percent: progressPercent(tableNames.length, current),
          },
        });
        const outPath = join(
          outputPath,
          serializeSqlFile({ table: tableName })
        );
        await this.onExportTables([tableName], outPath, async (progress) => {
          await data.onProgress({
            relative: {
              description: "Exporting",
              payload: tableName,
              current: progress.totalBytes,
              format: "size",
            },
            absolute: {
              total: tableNames.length,
              current: current,
              percent: progressPercent(tableNames.length, current),
            },
          });
        });
        current++;
      }
    }

    if (this.config.storedPrograms) {
      const outPath = join(outputPath, "stored-programs.sql");
      data.onProgress({
        relative: {
          description: "Exporting storaged programs",
        },
      });
      await this.onExportStoredPrograms(outPath);
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

    const items = (await readDir(restorePath))
      .map(parseSqlFile)
      .filter((v) => !!v) as SqlFile[];

    // Database check

    const databaseItems = items.filter((v) => v.database);

    if (databaseItems.length && !(await this.onDatabaseIsEmpty(database.name)))
      throw new AppError(`Target database is not empty: ${database.name}`);

    // Table check

    const restoreTables = items
      .filter((v) => v.table)
      .map((v) => v.table) as string[];

    const serverTables = await this.onFetchTableNames(database.name);
    const errorTables = restoreTables.filter((v) => serverTables.includes(v));

    if (errorTables.length) {
      throw new AppError(
        `Target table already exists: ${errorTables.join(", ")}`
      );
    }

    await this.onCreateDatabase(database);

    if (this.verbose) logExec("readdir", [restorePath]);

    let current = 0;
    for (const item of items) {
      const path = join(restorePath, item.fileName);
      data.onProgress({
        relative: {
          description: "Importing",
          payload: item.fileName,
        },
        absolute: {
          total: items.length,
          current: current,
          percent: progressPercent(items.length, current),
        },
      });
      await this.onImport(path, database.name);
      current++;
    }
  }
}
