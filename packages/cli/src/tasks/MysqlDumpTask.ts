import { runParallel } from "../utils/async";
import { logExec } from "../utils/cli";
import {
  ResolveDatabaseNameParams,
  resolveDatabaseName,
} from "../utils/datatruck/config";
import { AppError } from "../utils/error";
import {
  ensureEmptyDir,
  ensureSingleFile,
  groupFiles,
  mkdirIfNotExists,
  readDir,
  safeRename,
} from "../utils/fs";
import { progressPercent } from "../utils/math";
import { createMysqlCli } from "../utils/mysql";
import { endsWith } from "../utils/string";
import { CompressOptions, createTar, extractTar } from "../utils/tar";
import { mkTmpDir, useTempDir, useTempFile } from "../utils/temp";
import { SqlDumpTaskConfig, TargetDatabase } from "./SqlDumpTaskAbstract";
import {
  TaskBackupData,
  TaskPrepareRestoreData,
  TaskRestoreData,
  TaskAbstract,
} from "./TaskAbstract";
import { chmod, mkdir, readdir, rm } from "fs/promises";
import { dirname, join, relative } from "path";

export const mysqlDumpTaskName = "mysql-dump";

export type MysqlDumpTaskConfig = {
  /**
   * @default "sql"
   */
  dataFormat?: "csv" | "sql";
  csvSharedPath?: string;
  /**
   * @default 1
   */
  concurrency?: number;
  compress?: boolean | CompressOptions;
} & SqlDumpTaskConfig;

const suffix = {
  database: ".database.sql",
  stored: ".stored-programs.sql",
  table: ".table.sql",
  tableData: ".table-data.csv",
  tableSchema: ".table-schema.sql",
};

export class MysqlDumpTask extends TaskAbstract<MysqlDumpTaskConfig> {
  override async backup(data: TaskBackupData) {
    const compressAndClean = this.config.compress
      ? async (path: string) => {
          await createTar({
            include: [relative(snapshotPath, path)],
            output: `${path}.tar.gz`,
            path: dirname(path),
            compress: this.config.compress,
            verbose: data.options.verbose,
          });
          await rm(path);
        }
      : undefined;
    const snapshotPath =
      data.package.path ??
      (await mkTmpDir(mysqlDumpTaskName, "task", "backup", "snapshot"));

    await mkdirIfNotExists(snapshotPath);
    await ensureEmptyDir(snapshotPath);

    await using sql = await createMysqlCli({
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
                controller,
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
              const schemaPath = join(
                snapshotPath,
                `${tableName}${suffix.tableSchema}`,
              );
              await safeRename(join(tableSharedPath, schemaFile), schemaPath);
              await compressAndClean?.(schemaPath);
              const tablePath = join(
                snapshotPath,
                `${tableName}${suffix.tableData}`,
              );
              await safeRename(join(tableSharedPath, dataFile), tablePath);
              await compressAndClean?.(tablePath);
            } finally {
              await rm(tableSharedPath, { recursive: true });
            }
          } else {
            const outPath = join(snapshotPath, `${tableName}${suffix.table}`);
            await sql.dump({
              output: outPath,
              items: [tableName],
              database: this.config.database,
              controller,
              ...(concurrency === 1 && {
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
            await compressAndClean?.(outPath);
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
      await compressAndClean?.(outPath);
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
      await compressAndClean?.(outPath);
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
    await using sql = await createMysqlCli({
      ...this.config,
      database: undefined,
      verbose: data.options.verbose,
    });

    const snapshotPath = data.snapshotPath;

    const params: ResolveDatabaseNameParams = {
      packageName: data.package.name,
      snapshotId: data.options.snapshotId,
      snapshotDate: data.snapshot.date,
      action: "restore",
      database: undefined,
    };

    const database: TargetDatabase = {
      name: resolveDatabaseName(this.config.database, params),
    };

    if (this.config.targetDatabase && !data.options.initial)
      database.name = resolveDatabaseName(this.config.targetDatabase.name, {
        ...params,
        database: database.name,
      });

    const [files, compressed] = groupFiles(
      await readDir(snapshotPath),
      Object.values(suffix),
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
        let path = join(snapshotPath, file);
        const tempDir = compressed[file]
          ? await useTempDir(mysqlDumpTaskName, "task", "restore", "decompress")
          : undefined;
        try {
          if (tempDir) {
            await extractTar({
              input: join(snapshotPath, compressed[file]),
              output: tempDir.path,
              decompress: true,
              verbose: data.options.verbose,
            });
            path = await ensureSingleFile(tempDir.path);
          }
          await sql.importFile({
            path,
            database: database.name,
            controller,
          });
        } finally {
          await tempDir?.[Symbol.asyncDispose]();
        }
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
        const id = data.snapshot.id.slice(0, 8);
        const tableName = file.slice(0, suffix.tableData.length * -1);
        const sharedName = `tmp-dtt-restore-${id}-${tableName}.data.csv`;
        const temp = useTempFile(join(sharedDir!, sharedName));

        try {
          let csvFile = temp.path;

          if (compressed[file]) {
            await mkdirIfNotExists(temp.path);
            await extractTar({
              input: join(snapshotPath, compressed[file]),
              output: temp.path,
              decompress: true,
              verbose: data.options.verbose,
            });
            csvFile = await ensureSingleFile(temp.path);
          } else {
            const sourceFile = join(snapshotPath, file);
            await safeRename(sourceFile, temp.path);
          }

          await sql.importCsvFile({
            path: csvFile,
            database: database.name,
            table: tableName,
            controller,
          });
        } finally {
          await temp[Symbol.asyncDispose]();
        }
      },
    });
  }
}
