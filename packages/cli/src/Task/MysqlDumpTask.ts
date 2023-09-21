import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { readPartialFile } from "../utils/fs";
import { exec, logExecStdout } from "../utils/process";
import {
  SqlDumpTaskAbstract,
  SqlDumpTaskConfigType,
  TargetDatabaseType,
} from "./SqlDumpTaskAbstract";
import { createWriteStream } from "fs";
import { createReadStream } from "fs";
import { JSONSchema7 } from "json-schema";

export const mysqlDumpTaskName = "mysql-dump";

export type MysqlDumpTaskConfigType = {} & SqlDumpTaskConfigType;

export const mysqlDumpTaskDefinition: JSONSchema7 = {
  allOf: [makeRef(DefinitionEnum.sqlDumpTask)],
};

export class MysqlDumpTask extends SqlDumpTaskAbstract<MysqlDumpTaskConfigType> {
  async buildConnectionArgs(database?: string) {
    const password = await this.fetchPassword();
    return [
      `--host=${this.config.hostname}`,
      ...(this.config.port ? [`--port=${this.config.port}`] : []),
      `--user=${this.config.username}`,
      `--password=${password ?? ""}`,
      ...(database ? [database] : []),
    ];
  }
  override async onDatabaseIsEmpty(name: string) {
    const [total] = await this.fetchValues(`
      SELECT
        COUNT(*) AS total 
      FROM
        information_schema.tables
      WHERE
        table_schema = '${name}'
    `);
    return Number(total) ? false : true;
  }

  override async onCreateDatabase(database: TargetDatabaseType) {
    const query = `
      CREATE DATABASE IF NOT EXISTS \`${database.name}\`
      CHARACTER SET ${database.charset ?? "utf8"}
      COLLATE ${database.charset ?? "utf8_general_ci"}
    `;
    await this.onExecQuery(query);
  }

  override async onExecQuery(query: string) {
    return await exec(
      "mysql",
      [
        ...(await this.buildConnectionArgs()),
        "-e",
        query.replace(/\s{1,}/g, " "),
        "-N",
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
      },
    );
  }

  override async onFetchTableNames(database: string) {
    return await this.fetchValues(`
      SELECT
        table_name 
      FROM
        information_schema.tables
      WHERE
        table_schema = '${database}'
      ORDER BY
        table_name
	`);
  }

  override async onExportTables(
    tableNames: string[],
    output: string,
    onProgress: (progress: { totalBytes: number }) => void,
  ) {
    const stream = createWriteStream(output);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        stream.on("close", resolve);
        stream.on("error", reject);
      }),
      await exec(
        "mysqldump",
        [
          ...(await this.buildConnectionArgs(this.config.database)),
          "--lock-tables=false",
          "--skip-add-drop-table=false",
          ...tableNames,
        ],
        null,
        {
          pipe: {
            stream,
            onWriteProgress: onProgress,
          },
          log: {
            exec: this.verbose,
            stderr: this.verbose,
            allToStderr: true,
          },
          stderr: {
            toExitCode: true,
          },
        },
      ),
    ]);

    const headerContents = await readPartialFile(output, [0, 100]);
    const footerContents = await readPartialFile(output, [-100]);

    const successHeader = headerContents.split(/\r?\n/).some((line) => {
      const firstLine = line.trim().toLowerCase();
      return (
        firstLine.startsWith("-- mysql dump") ||
        firstLine.startsWith("-- mariadb dump")
      );
    });

    if (!successHeader) throw new AppError("No start line found");

    const successFooter = footerContents
      .split(/\r?\n/)
      .some((line) =>
        line.trim().toLowerCase().startsWith("-- dump completed"),
      );

    if (!successFooter)
      throw new AppError("No end line found (incomplete backup)");
  }

  override async onExportStoredPrograms(output: string) {
    const stream = createWriteStream(output);
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        stream.on("close", resolve);
        stream.on("error", reject);
      }),
      await exec(
        "mysqldump",
        [
          ...(await this.buildConnectionArgs(this.config.database)),
          "--lock-tables=false",
          "--routines",
          "--events",
          "--skip-triggers",
          "--no-create-info",
          "--no-data",
          "--no-create-db",
          "--skip-opt",
        ],
        null,
        {
          pipe: { stream: stream },
          log: {
            exec: this.verbose,
            stderr: this.verbose,
            allToStderr: true,
          },
          stderr: {
            toExitCode: true,
          },
        },
      ),
    ]);
  }

  override async onImport(path: string, database: string) {
    await exec("mysql", await this.buildConnectionArgs(database), null, {
      pipe: {
        stream: createReadStream(path),
        onReadProgress: (data) => {
          if (this.verbose)
            logExecStdout({
              data: JSON.stringify(data),
              colorize: true,
              stderr: true,
              lineSalt: true,
            });
        },
      },
      log: this.verbose,
      stderr: {
        toExitCode: true,
      },
    });
  }
}
