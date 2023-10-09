import { AppError } from "../Error/AppError";
import { runParallel } from "../utils/async";
import { logExec } from "../utils/cli";
import {
  ResolveDatabaseNameParamsType,
  resolveDatabaseName,
} from "../utils/datatruck/config";
import {
  ensureEmptyDir,
  mkdirIfNotExists,
  readDir,
  safeRename,
} from "../utils/fs";
import { progressPercent } from "../utils/math";
import { createMysqlCli } from "../utils/mysql";
import { endsWith } from "../utils/string";
import { mkTmpDir } from "../utils/temp";
import {
  SqlDumpTaskConfigType,
  TargetDatabaseType,
  sqlDumpTaskDefinition,
} from "./SqlDumpTaskAbstract";
import {
  TaskBackupData,
  TaskPrepareRestoreData,
  TaskRestoreData,
  TaskAbstract,
} from "./TaskAbstract";
import { chmod, mkdir, readdir, rm } from "fs/promises";
import { join } from "path";

export const mysqlDumpTaskName = "mysql-dump";

export type MysqlDumpTaskConfigType = {
  /**
   * @default "sql"
   */
  dataFormat?: "csv" | "sql";
  csvSharedPath?: string;
  /**
   * @default 1
   */
  concurrency?: number;
} & SqlDumpTaskConfigType;

export const mysqlDumpTaskDefinition = sqlDumpTaskDefinition({
  dataFormat: { enum: ["csv", "sql"] },
  concurrency: { type: "integer", minimum: 1 },
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
  override async backup(data: TaskBackupData) {
    const snapshotPath =
      data.package.path ??
      (await mkTmpDir(mysqlDumpTaskName, "task", "backup", "snapshot"));

    await mkdirIfNotExists(snapshotPath);
    await ensureEmptyDir(snapshotPath);

    const sql = await createMysqlCli({
      ...this.config,
      database: undefined,
      verbose: data.options.verbose,
    });
    const tableNames = await sql.fetchTableNames(
      this.config.database,
      this.config.includeTables,
      this.config.excludeTables,
    );

    const concurrency = this.config.concurrency ?? 4;
    const dataFormat = this.config.dataFormat ?? "sql";

    const sharedDir =
      dataFormat === "csv"
        ? await sql.initSharedDir(this.config.csvSharedPath)
        : undefined;

    if (this.config.oneFileByTable || sharedDir) {
      await runParallel({
        items: tableNames,
        concurrency,
        onChange: ({ processed: proccesed, buffer }) =>
          data.onProgress({
            relative: {
              description:
                buffer.size > 1 ? `Exporting (${buffer.size})` : "Exporting",
              payload: [...buffer.keys()].join(", "),
            },
            absolute: {
              total: tableNames.length,
              current: proccesed,
              percent: progressPercent(tableNames.length, proccesed),
            },
          }),
        onItem: async ({ item: tableName, index, controller }) => {
          if (sharedDir) {
            const tableSharedPath = join(
              sharedDir,
              `tmp-dtt-backup-${data.snapshot.id.slice(0, 8)}-${tableName}`,
            );
            if (data.options.verbose) {
              logExec("mkdir", ["-p", tableSharedPath]);
              logExec("chmod", ["777", tableSharedPath]);
            }
            await mkdir(tableSharedPath, { recursive: true });

            try {
              await chmod(tableSharedPath, 0o777);
              await sql.csvDump({
                sharedPath: tableSharedPath,
                items: [tableName],
                database: this.config.database,
                onSpawn: (p) => (controller.stop = () => p.kill()),
              });
              const files = await readdir(tableSharedPath);
              const schemaFile = `${tableName}.sql`;
              const dataFile = `${tableName}.txt`;
              const successCsvDump =
                files.length === 2 &&
                files.every((file) => file === schemaFile || file === dataFile);
              if (!successCsvDump)
                throw new AppError(
                  `Invalid csv dump files: ${files.join(", ")}`,
                );
              await safeRename(
                join(tableSharedPath, schemaFile),
                join(snapshotPath, `${tableName}${suffix.tableSchema}`),
              );
              await safeRename(
                join(tableSharedPath, dataFile),
                join(snapshotPath, `${tableName}${suffix.tableData}`),
              );
            } finally {
              await rm(tableSharedPath, { recursive: true });
            }
          } else {
            const outPath = join(snapshotPath, `${tableName}${suffix.table}`);
            await sql.dump({
              output: outPath,
              items: [tableName],
              database: this.config.database,
              onSpawn: (p) => (controller.stop = () => p.kill()),
              ...(concurrency !== 1 && {
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
                      current: index,
                      percent: progressPercent(tableNames.length, index),
                    },
                  });
                },
              }),
            });
            await sql.assertDumpFile(outPath);
          }
        },
      });
    } else {
      data.onProgress({
        relative: { description: "Exporting" },
      });
      const outPath = join(
        snapshotPath,
        `${this.config.database}${suffix.database}`,
      );
      await sql.dump({
        output: outPath,
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
      await sql.assertDumpFile(outPath);
    }

    if (this.config.storedPrograms ?? true) {
      data.onProgress({
        relative: { description: "Exporting stored programs" },
      });
      const outPath = join(
        snapshotPath,
        `${this.config.database}${suffix.stored}`,
      );
      await sql.dump({
        database: this.config.database,
        output: outPath,
        onlyStoredPrograms: true,
      });
      await sql.assertDumpFile(outPath);
    }
    return {
      snapshotPath,
    };
  }
  override async prepareRestore(data: TaskPrepareRestoreData) {
    return {
      snapshotPath:
        data.package.restorePath ??
        (await mkTmpDir(mysqlDumpTaskName, "task", "restore", "snapshot")),
    };
  }
  override async restore(data: TaskRestoreData) {
    const sql = await createMysqlCli({
      ...this.config,
      database: undefined,
      verbose: data.options.verbose,
    });

    const snapshotPath = data.snapshotPath;

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

    if (this.config.targetDatabase && data.options.restorePath)
      database.name = resolveDatabaseName(this.config.targetDatabase.name, {
        ...params,
        database: database.name,
      });

    const suffixes = Object.values(suffix);
    const files = (await readDir(snapshotPath)).filter((f) =>
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

    if (data.options.verbose) logExec("readdir", [snapshotPath]);

    const concurrency = this.config.concurrency ?? 1;

    let processed = 0;

    await runParallel({
      items: files.filter((f) => !f.endsWith(suffix.tableData)),
      concurrency,
      onFinished: () => {
        processed++;
      },
      onChange: ({ buffer }) =>
        data.onProgress({
          relative: {
            description:
              buffer.size > 1 ? `Importing (${buffer.size})` : "Importing",
            payload: [...buffer.keys()].join(", "),
          },
          absolute: {
            total: files.length,
            current: processed,
            percent: progressPercent(files.length, processed),
          },
        }),
      onItem: async ({ item: file, controller }) => {
        await sql.importFile({
          path: join(snapshotPath, file),
          database: database.name,
          onSpawn: (p) => (controller.stop = () => p.kill()),
        });
      },
    });

    await runParallel({
      items: dataFiles,
      concurrency,
      onFinished: () => {
        processed++;
      },
      onChange: ({ buffer }) =>
        data.onProgress({
          relative: {
            description:
              buffer.size > 1 ? `Importing (${buffer.size})` : "Importing",
            payload: [...buffer.keys()].join(", "),
          },
          absolute: {
            total: files.length,
            current: processed,
            percent: progressPercent(files.length, processed),
          },
        }),
      onItem: async ({ item: file, controller }) => {
        const filePath = join(snapshotPath, file);
        const tableName = file.slice(0, suffix.tableData.length * -1);
        const sharedFilePath = join(
          sharedDir!,
          `tmp-dtt-restore-${data.snapshot.id.slice(
            0,
            8,
          )}-${tableName}.data.csv`,
        );
        try {
          await safeRename(filePath, sharedFilePath);
          await sql.importCsvFile({
            path: sharedFilePath,
            database: database.name,
            table: tableName,
            onSpawn: (p) => (controller.stop = () => p.kill()),
          });
        } finally {
          await rm(sharedFilePath);
        }
      },
    });
  }
}
