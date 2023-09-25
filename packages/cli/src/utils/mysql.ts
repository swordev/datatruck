import { AppError } from "../Error/AppError";
import { existsFile, fetchData, mkdirIfNotExists } from "./fs";
import { exec, logExecStdout } from "./process";
import { createMatchFilter, splitLines, undefIfEmpty } from "./string";
import { randomBytes } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export type MysqlCliOptions = {
  password: string | { path: string };
  hostname: string;
  port?: number;
  username: string;
  verbose?: boolean;
};

export function createMysqlCli(options: MysqlCliOptions) {
  async function args() {
    const password = await fetchData(options.password, (p) => p.path);
    return [
      `--host=${options.hostname}`,
      ...(options.port ? [`--port=${options.port}`] : []),
      `--user=${options.username}`,
      `--password=${password ?? ""}`,
    ];
  }
  async function run(query: string, database?: string) {
    return await exec(
      "mysql",
      [
        ...(await args()),
        ...(database ? [database] : []),
        "-e",
        query.replace(/\s{1,}/g, " "),
        "-N",
        "--silent",
      ],
      undefined,
      {
        log: options.verbose,
        stderr: { toExitCode: true },
        stdout: { save: true },
      },
    );
  }
  async function fetchAll(query: string, database?: string) {
    return splitLines((await run(query, database)).stdout).map((line) =>
      line.split("\t"),
    );
  }

  async function fetchTableNames(
    database: string,
    include?: string[],
    exclude?: string[],
  ) {
    return (
      await fetchAll(`
      SELECT
        table_name 
      FROM
        information_schema.tables
      WHERE
        table_schema = '${database}'
      ORDER BY
        table_name
  `)
    )
      .map((r) => r[0])
      .filter(createMatchFilter(include, exclude));
  }
  async function dump(input: {
    output: string;
    database: string;
    items?: string[];
    onlyStoredPrograms?: boolean;
    onProgress?: (data: { totalBytes: number }) => void;
  }) {
    const stream = createWriteStream(input.output);

    return await Promise.all([
      new Promise<void>((resolve, reject) => {
        stream.on("close", resolve);
        stream.on("error", reject);
      }),
      await exec(
        "mysqldump",
        [
          ...(await args()),
          input.database,
          "--lock-tables=false",
          "--skip-add-drop-table=false",
          ...(input.onlyStoredPrograms
            ? [
                "--routines",
                "--events",
                "--skip-triggers",
                "--no-create-info",
                "--no-data",
                "--no-create-db",
                "--skip-opt",
              ]
            : []),
          ...(input.items || []),
        ],
        null,
        {
          stderr: { toExitCode: true },
          pipe: {
            stream,
            onWriteProgress: input.onProgress,
          },
          log: {
            exec: options.verbose,
            stderr: options.verbose,
            allToStderr: true,
          },
        },
      ),
    ]);
  }

  async function csvDump(input: {
    database: string;
    sharedPath: string;
    items?: string[];
  }) {
    await exec(
      "mysqldump",
      [
        ...(await args()),
        input.database,
        "--lock-tables=false",
        "--skip-add-drop-table=false",
        "-T",
        input.sharedPath,
        ...(input.items || []),
      ],
      null,
      {
        stderr: { toExitCode: true },
        log: {
          exec: options.verbose,
          stderr: options.verbose,
          allToStderr: true,
        },
      },
    );
  }

  async function importFile(path: string, database: string) {
    return await exec(
      "mysql",
      [
        `--init-command=SET ${[
          "autocommit=0",
          "unique_checks=0",
          "foreign_key_checks=0",
        ].join(",")};`,
        ...(await args()),
        database,
      ],
      null,
      {
        pipe: {
          stream: createReadStream(path),
          onReadProgress: (data) => {
            if (options.verbose)
              logExecStdout({
                data: JSON.stringify(data),
                colorize: true,
                stderr: true,
                lineSalt: true,
              });
          },
        },
        stderr: { toExitCode: true },
        log: options.verbose,
      },
    );
  }

  async function importCsvFile(path: string, database: string, table: string) {
    return run(
      `
      LOAD DATA LOCAL INFILE '${path.replaceAll("\\", "/")}'
      INTO TABLE ${table}
      FIELDS TERMINATED BY ','
      ENCLOSED BY '"'
      LINES TERMINATED BY '\\n'`,
      database,
    );
  }

  async function isDatabaseEmpty(database: string) {
    const [total] = await fetchAll(`
      SELECT
        COUNT(*) AS total 
      FROM
        information_schema.tables
      WHERE
        table_schema = '${database}'
    `);
    return Number(total) ? false : true;
  }

  async function createDatabase(database: { name: string; charset?: string }) {
    await run(`
      CREATE DATABASE IF NOT EXISTS \`${database.name}\`
      CHARACTER SET ${database.charset ?? "utf8"}
      COLLATE ${database.charset ?? "utf8_general_ci"}
    `);
  }

  async function fetchVariable(name: string) {
    const stdout = undefIfEmpty(
      (await run(`SHOW VARIABLES LIKE "${name}"`)).stdout.trim(),
    );

    return stdout ? undefIfEmpty(stdout.slice(name.length).trim()) : undefined;
  }

  async function initSharedDir(sharedDir?: string) {
    const secure_file_priv = await fetchVariable("secure_file_priv");
    if (secure_file_priv?.toUpperCase() === "NULL")
      throw new AppError("'secure_file_priv' is null in MySQL Server");
    const dir =
      sharedDir ??
      secure_file_priv ??
      (await fetchVariable("tmpdir")) ??
      tmpdir();
    await checkSharedDir(dir);
    return dir;
  }

  async function checkSharedDir(dir: string) {
    const id = randomBytes(8).toString("hex");
    const outFile = join(dir, `dtt_test_${id}`);
    const outFileVar = JSON.stringify(outFile.replaceAll("\\", "/"));
    try {
      await mkdirIfNotExists(dir);
      await run(`SELECT 1 INTO OUTFILE ${outFileVar}`);
      const exists = await existsFile(outFile);
      if (!exists)
        throw new AppError(`MySQL shared dir is not reached: ${dir}`);
    } finally {
      try {
        await rm(outFile);
      } catch (e) {}
    }
  }

  return {
    options,
    initSharedDir,
    args,
    run,
    fetchAll,
    dump,
    fetchTableNames,
    importFile,
    isDatabaseEmpty,
    createDatabase,
    csvDump,
    importCsvFile,
    fetchVariable,
  };
}
