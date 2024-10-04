import { AsyncProcess } from "./async-process";
import { logExec } from "./cli";
import { AppError } from "./error";
import { existsFile, fetchData, mkdirIfNotExists, readPartialFile } from "./fs";
import { logStdout } from "./process";
import { createPatternFilter, undefIfEmpty } from "./string";
import { mkTmpDir } from "./temp";
import { randomBytes } from "crypto";
import { chmod, rm, writeFile } from "fs/promises";
import { ConnectionOptions, createConnection } from "mysql2/promise";
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

export async function assertDumpFile(path: string) {
  const headerContents = await readPartialFile(path, [0, 100]);
  const footerContents = await readPartialFile(path, [-100]);

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
    .some((line) => line.trim().toLowerCase().startsWith("-- dump completed"));

  if (!successFooter)
    throw new AppError("No end line found (incomplete backup)");
}

export async function createMysqlCli(options: MysqlCliOptions) {
  let sqlConfigPath: string | undefined;
  const password = (await fetchData(options.password, (p) => p.path)) ?? "";
  const connectionOptions = {
    host: options.hostname,
    user: options.username,
    password,
    port: options.port,
    database: options.database,
  } satisfies ConnectionOptions;
  if (options.verbose)
    logExec("sql.createConnection", [
      JSON.stringify(
        {
          ...connectionOptions,
          password: "********",
        },
        null,
        2,
      ),
    ]);
  const sql = await createConnection(connectionOptions);

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
    const path = join(dir, "mysql.conf");
    await writeFile(path, data.join("\n"));
    return (sqlConfigPath = path);
  }

  async function args() {
    return [`--defaults-file=${await createSqlConfig()}`];
  }

  async function fetchAll<T>(query: string, params?: any[]): Promise<T[]> {
    if (options.verbose)
      logExec("> sql.query", [query, JSON.stringify({ params }, null, 2)]);
    const [rows] = await sql.query(query, params);
    if (options.verbose)
      logExec("< sql.query", [JSON.stringify(rows, null, 2)]);
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
        TABLE_NAME AS table_name
      FROM
        information_schema.TABLES
      WHERE
        TABLE_SCHEMA = ?
      ORDER BY
        TABLE_NAME
  `,
        [database],
      )
    )
      .map((r) => r.table_name)
      .filter(createPatternFilter({ include, exclude }));
  }
  async function dump(input: {
    output: string;
    database: string;
    items?: string[];
    onlyStoredPrograms?: boolean;
    controller?: AbortController;
    onProgress?: (data: { totalBytes: number }) => void;
  }) {
    const process = new AsyncProcess(
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
      {
        $controller: input.controller,
        $log: {
          exec: options.verbose,
          stderr: options.verbose,
          allToStderr: true,
        },
      },
    );
    await process.stdout.pipe(input.output, input.onProgress);
  }

  async function csvDump(input: {
    database: string;
    sharedPath: string;
    items?: string[];
    controller?: AbortController;
  }) {
    const process = new AsyncProcess(
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
      {
        $controller: input.controller,
        $log: {
          exec: options.verbose,
          stderr: options.verbose,
          allToStderr: true,
        },
      },
    );
    await process.waitForClose();
  }

  async function importFile(input: {
    path: string;
    database: string;
    controller?: AbortController;
  }) {
    const process = new AsyncProcess(
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
      {
        $log: options.verbose,
        $controller: input.controller,
      },
    );

    await process.stdin.pipe(
      input.path,
      options.verbose
        ? (data) =>
            logStdout({
              data: JSON.stringify(data),
              colorize: true,
              stderr: true,
              lineSalt: true,
            })
        : undefined,
    );
  }

  async function importCsvFile(input: {
    path: string;
    database: string;
    table: string;
    controller?: AbortController;
  }) {
    const query = `
      LOAD DATA LOCAL INFILE ${JSON.stringify(input.path.replaceAll("\\", "/"))}
      INTO TABLE ${input.table}
      FIELDS TERMINATED BY '\\t'
      LINES TERMINATED BY '\\n'
    `;
    const process = new AsyncProcess(
      "mysql",
      [
        ...(await args()),
        input.database,
        "--local-infile",
        "-e",
        flatQuery(query),
        "-N",
        "--silent",
      ],
      {
        $controller: input.controller,
        $log: options.verbose,
      },
    );

    await process.waitForClose();
  }

  async function isDatabaseEmpty(database: string) {
    const [row] = await fetchAll<{ total: number }>(
      `
      SELECT
        COUNT(*) AS total 
      FROM
        information_schema.TABLES
      WHERE
        TABLE_SCHEMA = ?
    `,
      [database],
    );
    return Number(row.total) ? false : true;
  }

  async function createDatabase(database: { name: string; charset?: string }) {
    await execute(`
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
      await execute(`SELECT 1 INTO OUTFILE ${outFileVar}`);
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
    if (options.verbose)
      logExec("> sql.execute", [query, JSON.stringify({ params }, null, 2)]);
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
    if (options.verbose) logExec("sql.changeUser", [name]);
    await sql.changeUser({ database: name });
  }
  return {
    async [Symbol.asyncDispose]() {
      if (options.verbose) logExec("sql.end");
      await sql.end();
    },
    options,
    initSharedDir,
    args,
    execute,
    insert,
    changeDatabase,
    fetchAll,
    dump,
    assertDumpFile,
    fetchTableNames,
    importFile,
    isDatabaseEmpty,
    createDatabase,
    csvDump,
    importCsvFile,
    fetchVariable,
  };
}
