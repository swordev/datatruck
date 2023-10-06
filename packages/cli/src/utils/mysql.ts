import { AppError } from "../Error/AppError";
import { logExec } from "./cli";
import { existsFile, fetchData, mkdirIfNotExists } from "./fs";
import { exec, logExecStdout } from "./process";
import { createMatchFilter, undefIfEmpty } from "./string";
import { mkTmpDir } from "./temp";
import { ChildProcess } from "child_process";
import { randomBytes } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { chmod, rm, writeFile } from "fs/promises";
import { createConnection } from "mysql2/promise";
import { tmpdir } from "os";
import { join } from "path";

export type MysqlCliOptions = {
  password: string | { path: string };
  hostname: string;
  port?: number;
  username: string;
  verbose?: boolean;
  database?: string;
};

function flatQuery(query: string, params?: any[]) {
  query = query.replace(/\s{1,}/g, " ").trim();
  let paramIndex = 0;
  return params
    ? query.replace(/\?/g, () => {
        const param = params![paramIndex++];
        return param ? JSON.stringify(param) : "?";
      })
    : query;
}

export async function createMysqlCli(options: MysqlCliOptions) {
  let sqlConfigPath: string | undefined;
  const password = (await fetchData(options.password, (p) => p.path)) ?? "";
  const sql = await createConnection({
    host: options.hostname,
    user: options.username,
    password,
    port: options.port,
    database: options.database,
  });

  async function createSqlConfig() {
    if (sqlConfigPath) return sqlConfigPath;
    const dir = await mkTmpDir("mysql", "config");
    const password = await fetchData(options.password, (p) => p.path);
    const data = [
      `[client]`,
      `host = "${options.hostname}"`,
      ...(options.port ? [`port = "${options.port}"`] : []),
      `user = "${options.username}"`,
      `password = "${password}"`,
    ];
    await writeFile((sqlConfigPath = join(dir, "mysql.conf")), data.join("\n"));
    return sqlConfigPath;
  }

  async function args() {
    return [`--defaults-file=${await createSqlConfig()}`];
  }

  async function run(
    query: string,
    database?: string,
    extra: string[] = [],
    onSpawn?: (p: ChildProcess) => void,
  ) {
    return await exec(
      "mysql",
      [
        ...(await args()),
        ...(database ? [database] : []),
        ...(extra || []),
        "-e",
        flatQuery(query),
        "-N",
        "--silent",
      ],
      undefined,
      {
        onSpawn,
        log: options.verbose,
        stderr: { toExitCode: true },
        stdout: { save: true },
      },
    );
  }
  async function fetchAll<T>(query: string, params?: any[]): Promise<T[]> {
    const [rows] = await sql.query(query, params);
    return rows as T[];
  }

  async function fetchTableNames(
    database: string,
    include?: string[],
    exclude?: string[],
  ) {
    return (
      await fetchAll<{ table_name: string }>(
        `
      SELECT
        table_name 
      FROM
        information_schema.tables
      WHERE
        table_schema = ?
      ORDER BY
        table_name
  `,
        [database],
      )
    )
      .map((r) => r.table_name)
      .filter(createMatchFilter(include, exclude));
  }
  async function dump(input: {
    output: string;
    database: string;
    items?: string[];
    onlyStoredPrograms?: boolean;
    onSpawn?: (p: ChildProcess) => void;
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
          onSpawn: input.onSpawn,
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
    onSpawn?: (p: ChildProcess) => void;
  }) {
    await exec(
      "mysqldump",
      [
        ...(await args()),
        input.database,
        "--lock-tables=false",
        "--skip-add-drop-table=false",
        "--fields-terminated-by=0x09", // \t
        "--lines-terminated-by=0x0a", // \n
        "-T",
        input.sharedPath,
        ...(input.items || []),
      ],
      null,
      {
        stderr: { toExitCode: true },
        onSpawn: input.onSpawn,
        log: {
          exec: options.verbose,
          stderr: options.verbose,
          allToStderr: true,
        },
      },
    );
  }

  async function importFile(input: {
    path: string;
    database: string;
    onSpawn?: (p: ChildProcess) => void;
  }) {
    return await exec(
      "mysql",
      [
        ...(await args()),
        `--init-command=SET ${[
          "autocommit=0",
          "unique_checks=0",
          "foreign_key_checks=0",
        ].join(",")};`,
        input.database,
      ],
      null,
      {
        onSpawn: input.onSpawn,
        pipe: {
          stream: createReadStream(input.path),
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

  async function importCsvFile(input: {
    path: string;
    database: string;
    table: string;
    onSpawn?: (p: ChildProcess) => void;
  }) {
    return run(
      `
      LOAD DATA LOCAL INFILE ${JSON.stringify(input.path.replaceAll("\\", "/"))}
      INTO TABLE ${input.table}
      FIELDS TERMINATED BY '\\t'
      LINES TERMINATED BY '\\n'`,
      input.database,
      ["--local-infile"],
      input.onSpawn,
    );
  }

  async function isDatabaseEmpty(database: string) {
    const [row] = await fetchAll<{ total: number }>(
      `
      SELECT
        COUNT(*) AS total 
      FROM
        information_schema.tables
      WHERE
        table_schema = ?
    `,
      [database],
    );
    return Number(row.total) ? false : true;
  }

  async function createDatabase(database: { name: string; charset?: string }) {
    await sql.execute(`
      CREATE DATABASE IF NOT EXISTS \`${database.name}\`
      CHARACTER SET ${database.charset ?? "utf8"}
      COLLATE ${database.charset ?? "utf8_general_ci"}
    `);
  }

  async function fetchVariable(name: string) {
    const rows = await fetchAll<{ Value: string }>(`SHOW VARIABLES LIKE ?`, [
      name,
    ]);
    return undefIfEmpty(rows?.[0].Value);
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
      await chmod(dir, 0o777);
      await sql.execute(`SELECT 1 INTO OUTFILE ${outFileVar}`);
      const exists = await existsFile(outFile);
      if (!exists)
        throw new AppError(`MySQL shared dir is not reached: ${dir}`);
    } finally {
      try {
        await rm(outFile);
      } catch (e) {}
    }
  }

  async function execute(query: string, params: any[] = []) {
    if (options.verbose) {
      logExec(`mysql`, [
        ...(await args()),
        "-e",
        `"${flatQuery(query)}"`,
        ...(sql.config.database ? [sql.config.database] : []),
      ]);
    }
    await sql.execute(query, params);
  }

  async function insert(tableName: string, item: Record<string, any>) {
    const columnsExpr = Object.keys(item)
      .map((v) => v)
      .join(", ");
    const paramsExpr = Array.from({ length: Object.keys(item).length })
      .fill("?")
      .join(", ");
    const params = Object.values(item);
    await execute(
      `INSERT INTO ${tableName} (${columnsExpr}) VALUES (${paramsExpr})`,
      params,
    );
  }

  async function changeDatabase(name: string) {
    await sql.changeUser({ database: name });
  }
  return {
    options,
    initSharedDir,
    args,
    run,
    execute,
    insert,
    changeDatabase,
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
