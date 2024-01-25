import { AsyncProcess } from "../utils/async-process";
import {
  SqlDumpTaskAbstract,
  SqlDumpTaskConfig,
  TargetDatabase,
} from "./SqlDumpTaskAbstract";
import { normalize } from "path";

export const postgresqlDumpTaskName = "postgresql-dump";

export type PostgresqlDumpTaskConfig = SqlDumpTaskConfig;

export class PostgresqlDumpTask extends SqlDumpTaskAbstract<PostgresqlDumpTaskConfig> {
  async buildConnectionArgs(database?: string) {
    const password = await this.fetchPassword();
    const config = this.config;
    return [
      "--no-password",
      `--dbname=postgresql://${config.username}:${password ?? ""}@${
        config.hostname
      }:${config.port ?? 5432}/${database ?? config.database ?? ""}`,
    ];
  }

  override async onDatabaseIsEmpty(name: string) {
    const [total] = await this.fetchValues(`
      SELECT
        COUNT(*) AS total
      FROM
        information_schema.tables
      WHERE
        table_catalog = '${name}' AND
        table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    return Number(total) ? false : true;
  }

  override async onCreateDatabase(database: TargetDatabase) {
    let query = `CREATE DATABASE ${database.name}`;
    if (database.charset || database.collate) {
      query += ` WITH`;
      if (database.charset) {
        query += ` ENCONDING '${database.charset}'`;
      }
      if (database.collate) {
        query += ` LC_COLLATE '${database.collate}'`;
      }
    }

    await this.onExecQuery(query);
  }

  override async onExecQuery(query: string) {
    return await AsyncProcess.stdout(
      "psql",
      [
        ...(await this.buildConnectionArgs()),
        "-t",
        "-c",
        query.replace(/\s{1,}/g, " "),
      ],
      { $log: this.verbose },
    );
  }

  override async onFetchTableNames(database: string) {
    return await this.fetchValues(`
      SELECT
        CONCAT(table_schema, '.', table_name)
      FROM
        information_schema.tables
      WHERE
        table_catalog = '${database}' AND
        table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY
        CONCAT(table_schema, '.', table_name)
	  `);
  }

  override async onExportTables(
    tableNames: string[],
    output: string,
    onProgress: (progress: { totalBytes: number }) => void,
  ) {
    const dumpProcess = new AsyncProcess(
      "pg_dump",
      [
        ...(await this.buildConnectionArgs(this.config.database)),
        ...(tableNames?.flatMap((v) => ["-t", v]) ?? []),
      ],
      {
        $log: {
          exec: this.verbose,
          stderr: this.verbose,
          allToStderr: true,
        },
      },
    );

    await dumpProcess.stdout.pipe(output, onProgress);
  }

  override async onExportStoredPrograms() {
    throw new Error(`Method not implemented: onExportStoredPrograms`);
  }

  override async onImport(path: string, database: string) {
    await AsyncProcess.exec(
      "psql",
      [...(await this.buildConnectionArgs(database)), "-f", normalize(path)],
      {
        $log: {
          exec: this.verbose,
          stderr: this.verbose,
          allToStderr: true,
        },
      },
    );
  }
}
