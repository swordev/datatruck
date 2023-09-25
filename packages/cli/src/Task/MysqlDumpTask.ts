import { AppError } from "../Error/AppError";
import { logExec } from "../utils/cli";
import {
  ResolveDatabaseNameParamsType,
  resolveDatabaseName,
} from "../utils/datatruck/config";
import { readDir } from "../utils/fs";
import { progressPercent } from "../utils/math";
import { createMysqlCli } from "../utils/mysql";
import { endsWith } from "../utils/string";
import {
  SqlDumpTaskConfigType,
  TargetDatabaseType,
  sqlDumpTaskDefinition,
} from "./SqlDumpTaskAbstract";
import { BackupDataType, RestoreDataType, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { mkdir, readdir, rename, rm } from "fs/promises";
import { join } from "path";

export const mysqlDumpTaskName = "mysql-dump";

export type MysqlDumpTaskConfigType = {
  /**
   * @default "sql"
   */
  dataFormat?: "csv" | "sql";
  csvSharedPath?: string;
} & SqlDumpTaskConfigType;

export const mysqlDumpTaskDefinition = sqlDumpTaskDefinition({
  dataFormat: { enum: ["csv", "sql"] },
  csvSharedPath: { type: "string" },
});

const suffix = {
  database: ".database.sql",
  stored: ".stored-programs.sql",
  table: ".table.sql",
  tableData: ".table-data.csv",
  tableSchema: ".table-schema.sql",
};

export class MysqlDumpTask extends TaskAbstract<MysqlDumpTaskConfigType> {
  override async onBackup(data: BackupDataType) {
    const sql = createMysqlCli({
      ...this.config,
      verbose: data.options.verbose,
    });
    const tableNames = await sql.fetchTableNames(
      this.config.database,
      this.config.includeTables,
      this.config.excludeTables,
    );

    const outputPath = data.package.path;
    ok(typeof outputPath === "string");

    const dataFormat = this.config.dataFormat ?? "sql";

    await mkdir(outputPath, { recursive: true });

    const sharedDir =
      dataFormat === "csv"
        ? await sql.initSharedDir(this.config.csvSharedPath)
        : undefined;

    if (this.config.oneFileByTable || sharedDir) {
      let current = 0;
      for (const tableName of tableNames) {
        await data.onProgress({
          relative: {
            description: "Exporting",
            payload: tableName,
          },
          absolute: {
            total: tableNames.length,
            current,
            percent: progressPercent(tableNames.length, current),
          },
        });
        if (sharedDir) {
          const tableSharedPath = join(
            sharedDir,
            `tmp-dtt-backup-${data.snapshot.id.slice(0, 8)}-${tableName}`,
          );

          if (data.options.verbose) logExec("mkdir", [tableSharedPath]);
          await mkdir(tableSharedPath, { recursive: true });
          try {
            await sql.csvDump({
              sharedPath: tableSharedPath,
              items: [tableName],
              database: this.config.database,
            });
            const files = await readdir(tableSharedPath);
            const schemaFile = `${tableName}.sql`;
            const dataFile = `${tableName}.txt`;
            const successCsvDump =
              files.length === 2 &&
              files.every((file) => file === schemaFile || file === dataFile);
            if (!successCsvDump)
              throw new AppError(`Invalid csv dump files: ${files.join(", ")}`);
            await rename(
              join(tableSharedPath, schemaFile),
              join(outputPath, `${tableName}${suffix.tableSchema}`),
            );
            await rename(
              join(tableSharedPath, dataFile),
              join(outputPath, `${tableName}${suffix.tableData}`),
            );
          } finally {
            await rm(tableSharedPath, { recursive: true });
          }
        } else {
          const outPath = join(outputPath, `${tableName}${suffix.table}`);
          await sql.dump({
            output: outPath,
            items: [tableName],
            database: this.config.database,
            onProgress(progress) {
              data.onProgress({
                relative: {
                  description: "Exporting",
                  payload: tableName,
                  current: progress.totalBytes,
                  format: "size",
                },
                absolute: {
                  total: tableNames.length,
                  current,
                  percent: progressPercent(tableNames.length, current),
                },
              });
            },
          });
        }
        current++;
      }
    } else {
      await data.onProgress({
        relative: { description: "Exporting" },
      });
      await sql.dump({
        output: join(outputPath, `${this.config.database}${suffix.database}`),
        items: tableNames,
        database: this.config.database,
        onProgress: (progress) =>
          data.onProgress({
            absolute: {
              description: "Exporting in single file",
              current: progress.totalBytes,
              format: "size",
            },
          }),
      });
    }

    if (this.config.storedPrograms ?? true) {
      await data.onProgress({
        relative: { description: "Exporting stored programs" },
      });
      await sql.dump({
        database: this.config.database,
        output: join(outputPath, `${this.config.database}${suffix.stored}`),
        onlyStoredPrograms: true,
      });
    }
  }
  override async onRestore(data: RestoreDataType) {
    const sql = createMysqlCli({
      ...this.config,
      verbose: data.options.verbose,
    });

    const restorePath = data.package.restorePath;
    ok(typeof restorePath === "string");

    const params: ResolveDatabaseNameParamsType = {
      packageName: data.package.name,
      snapshotId: data.options.snapshotId,
      snapshotDate: data.snapshot.date,
      action: "restore",
      database: undefined,
    };

    const database: TargetDatabaseType = {
      name: resolveDatabaseName(this.config.database, params),
    };

    if (this.config.targetDatabase)
      database.name = resolveDatabaseName(this.config.targetDatabase.name, {
        ...params,
        database: database.name,
      });

    const suffixes = Object.values(suffix);
    const files = (await readDir(restorePath)).filter((f) =>
      endsWith(f, suffixes),
    );

    // Database check

    if (
      files.some((f) => f.endsWith(suffix.database)) &&
      !(await sql.isDatabaseEmpty(database.name))
    )
      throw new AppError(`Target database is not empty: ${database.name}`);

    // Table check

    const restoreTables = [
      ...new Set(
        ...files
          .filter((f) =>
            endsWith(f, [suffix.table, suffix.tableSchema, suffix.tableData]),
          )
          .map((f) => f.split(".")[0]),
      ),
    ];
    const serverTables = await sql.fetchTableNames(database.name);
    const errorTables = restoreTables.filter((v) => serverTables.includes(v));

    if (errorTables.length)
      throw new AppError(
        `Target table already exists: ${errorTables.join(", ")}`,
      );

    // Data check

    const dataFiles = files.filter((f) => f.endsWith(suffix.tableData));
    const sharedDir = dataFiles.length
      ? await sql.initSharedDir(this.config.csvSharedPath)
      : undefined;

    await sql.createDatabase(database);

    if (data.options.verbose) logExec("readdir", [restorePath]);

    let current = 0;
    for (const file of files.filter((f) => !f.endsWith(suffix.tableData))) {
      const path = join(restorePath, file);
      data.onProgress({
        relative: {
          description: "Importing",
          payload: file,
        },
        absolute: {
          total: files.length,
          current: current,
          percent: progressPercent(files.length, current),
        },
      });
      await sql.importFile(path, database.name);
      current++;
    }

    for (const file of dataFiles) {
      const filePath = join(restorePath, file);
      const tableName = file.slice(0, suffix.tableData.length * -1);

      data.onProgress({
        relative: {
          description: "Importing",
          payload: file,
        },
        absolute: {
          total: files.length,
          current: current,
          percent: progressPercent(files.length, current),
        },
      });

      const sharedFilePath = join(
        sharedDir!,
        `tmp-dtt-restore-${data.snapshot.id.slice(0, 8)}-${tableName}.data.csv`,
      );
      try {
        await rename(filePath, sharedFilePath);
        await sql.importCsvFile(sharedFilePath, database.name, tableName);
      } finally {
        await rm(sharedFilePath);
      }
      current++;
    }
  }
}
