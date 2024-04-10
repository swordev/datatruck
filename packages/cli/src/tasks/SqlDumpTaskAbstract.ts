import { logExec } from "../utils/cli";
import { resolveDatabaseName } from "../utils/datatruck/config";
import { AppError } from "../utils/error";
import {
  ensureEmptyDir,
  existsDir,
  mkdirIfNotExists,
  safeReaddir,
} from "../utils/fs";
import { progressPercent } from "../utils/math";
import { createPatternFilter } from "../utils/string";
import { mkTmpDir } from "../utils/temp";
import {
  TaskBackupData,
  TaskPrepareRestoreData,
  TaskRestoreData,
  TaskAbstract,
} from "./TaskAbstract";
import { ok } from "assert";
import { mkdir, readFile } from "fs/promises";
import { join } from "path";

export type TargetDatabase = {
  name: string;
  charset?: string;
  collate?: string;
};

export type SqlDumpTaskConfig = {
  password: string | { path: string };
  hostname: string;
  port?: number;
  database: string;
  username: string;
  /**
   * @default true
   */
  storedPrograms?: boolean;
  targetDatabase?: TargetDatabase;
  includeTables?: string[];
  excludeTables?: string[];
  oneFileByTable?: boolean;
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
    throw new AppError(`Invalid SQL file type: ${type}`);
  }
}

export abstract class SqlDumpTaskAbstract<
  TConfig extends SqlDumpTaskConfig,
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
    return result.split(/\r?\n/).reduce((result, value) => {
      value = value.trim();
      if (value.length) result.push(value);
      return result;
    }, [] as string[]);
  }

  abstract onCreateDatabase(database: TargetDatabase): Promise<void>;
  abstract onDatabaseIsEmpty(databaseName: string): Promise<boolean>;
  abstract onFetchTableNames(database: string): Promise<string[]>;
  abstract onExecQuery(query: string): Promise<string>;
  abstract onExportTables(
    tableNames: string[],
    output: string,
    onProgress: (data: { totalBytes: number }) => void,
  ): Promise<void>;
  abstract onExportStoredPrograms(output: string): Promise<void>;
  abstract onImport(path: string, database: string): Promise<void>;

  override async backup(data: TaskBackupData) {
    this.verbose = data.options.verbose;

    const snapshotPath =
      data.package.path ??
      (await mkTmpDir("sqldump", "task", "backup", "snapshot"));

    await mkdirIfNotExists(snapshotPath);
    await ensureEmptyDir(snapshotPath);

    const config = this.config;
    const allTableNames = await this.onFetchTableNames(this.config.database);
    const tableNames = allTableNames.filter(
      createPatternFilter({
        include: config.includeTables,
        exclude: config.excludeTables,
      }),
    );

    ok(typeof snapshotPath === "string");

    if (!(await existsDir(snapshotPath)))
      await mkdir(snapshotPath, { recursive: true });

    if (!this.config.oneFileByTable) {
      const outPath = join(
        snapshotPath,
        serializeSqlFile({ database: this.config.database }),
      );
      data.onProgress({
        relative: {
          description: "Exporting",
        },
      });
      await this.onExportTables(tableNames, outPath, async (progress) => {
        data.onProgress({
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
        data.onProgress({
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
          snapshotPath,
          serializeSqlFile({ table: tableName }),
        );
        await this.onExportTables([tableName], outPath, async (progress) => {
          data.onProgress({
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
      const outPath = join(snapshotPath, "stored-programs.sql");
      data.onProgress({
        relative: {
          description: "Exporting storaged programs",
        },
      });
      await this.onExportStoredPrograms(outPath);
    }

    return {
      snapshotPath: snapshotPath,
    };
  }
  override async prepareRestore(data: TaskPrepareRestoreData) {
    return {
      snapshotPath:
        data.package.restorePath ??
        (await mkTmpDir("sqldump", "task", "restore", "snapshot")),
    };
  }
  override async restore(data: TaskRestoreData) {
    const snapshotPath = data.snapshotPath;
    this.verbose = data.options.verbose;

    const database: TargetDatabase = {
      name: resolveDatabaseName(this.config.database, {
        packageName: data.package.name,
        snapshotId: data.options.id,
        snapshotDate: data.snapshot.date,
        action: "restore",
        database: undefined,
      }),
    };

    if (this.config.targetDatabase && !data.options.initial) {
      database.name = resolveDatabaseName(this.config.targetDatabase.name, {
        packageName: data.package.name,
        snapshotId: data.options.id,
        snapshotDate: data.snapshot.date,
        action: "restore",
        database: database.name,
      });
    }

    const items = (await safeReaddir(snapshotPath))
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
        `Target table already exists: ${errorTables.join(", ")}`,
      );
    }

    await this.onCreateDatabase(database);

    if (this.verbose) logExec("readdir", [snapshotPath]);

    let current = 0;
    for (const item of items) {
      const path = join(snapshotPath, item.fileName);
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
