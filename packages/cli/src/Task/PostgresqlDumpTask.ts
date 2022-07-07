import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { exec } from "../util/process-util";
import {
  SqlDumpTaskAbstract,
  SqlDumpTaskConfigType,
  TargetDatabaseType,
} from "./SqlDumpTaskAbstract";
import { createWriteStream } from "fs";
import { JSONSchema7 } from "json-schema";
import { normalize } from "path";

export const postgresqlDumpTaskName = "postgresql-dump";

export type PostgresqlDumpTaskConfigType = {} & SqlDumpTaskConfigType;

export const postgresqlDumpTaskDefinition: JSONSchema7 = {
  allOf: [makeRef(DefinitionEnum.sqlDumpTask)],
};

export class PostgresqlDumpTask extends SqlDumpTaskAbstract<PostgresqlDumpTaskConfigType> {
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

  override async onCreateDatabase(database: TargetDatabaseType) {
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
    return await exec(
      "psql",
      [
        ...(await this.buildConnectionArgs()),
        "-t",
        "-c",
        query.replace(/\s{1,}/g, " "),
      ],
      undefined,
      {
        log: this.verbose,
        stderr: {
          toExitCode: true,
        },
        stdout: {
          save: true,
        },
      }
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
	  `);
  }

  override async onExportTables(tableNames: string[], output: string) {
    const stream = createWriteStream(output);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        stream.on("close", resolve);
        stream.on("error", reject);
      }),
      exec(
        "pg_dump",
        [
          ...(await this.buildConnectionArgs()),
          ...(tableNames?.flatMap((v) => ["-t", v]) ?? []),
        ],
        null,
        {
          pipe: { stream: stream },
          stderr: {
            toExitCode: true,
          },
          log: this.verbose,
        }
      ),
    ]);
  }

  override async onExportStoredPrograms() {
    throw new Error(`Method not implemented: onExportStoredPrograms`);
  }

  override async onImport(path: string, database: string) {
    await exec(
      "psql",
      [...(await this.buildConnectionArgs(database)), "-f", normalize(path)],
      undefined,
      {
        log: this.verbose,
      }
    );
  }
}
