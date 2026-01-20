import { Ntfy } from "./ntfy.js";
import { runParallel } from "@datatruck/cli/utils/async.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { duration } from "@datatruck/cli/utils/date.js";
import {
  ensureFreeDiskSpace,
  fetchDiskStats,
} from "@datatruck/cli/utils/fs.js";
import { createMysqlCli } from "@datatruck/cli/utils/mysql.js";
import { match } from "@datatruck/cli/utils/string.js";
import { existsSync } from "fs";
import { mkdir, rm, stat } from "fs/promises";
import { basename, dirname } from "path";

export type MySQLDumpItem = {
  name: string;
  database: string;
  out:
    | {
        tables: string[];
        path: string | false;
      }[]
    | string;
};

export type MySQLDumpOptions = {
  name: string;
  verbose?: boolean;
  minFreeSpace?: string;
  concurrency?: number;
  connection: MySQLDumpConnection;
};

export type MySQLDumpConnection = {
  hostname: string;
  password: string;
  username: string;
  port?: number;
};

export type MySQLDumpStats = {
  bytes: number;
  files: number;
};

export class MySQLDump {
  constructor(
    readonly options: MySQLDumpOptions,
    protected ntfy: Ntfy,
  ) {}
  readonly processes: {
    name: string;
    stats: MySQLDumpStats;
    error?: Error;
  }[] = [];
  protected tables: Record<string, string[]> = {};
  protected outPaths = new Set<string>();
  protected startTime = Date.now();
  protected async fetchTables(
    database: string,
    fetcher: (database: string) => Promise<string[]>,
  ) {
    const tables = this.tables[database] ?? (await fetcher(database));
    this.tables[database] = tables;
    return tables;
  }

  async run(input: MySQLDumpItem[] | MySQLDumpItem) {
    await using sql = await createMysqlCli({
      ...this.options.connection,
      verbose: this.options.verbose,
    });
    const items = Array.isArray(input) ? input : [input];
    for (const item of items) {
      await this.runSingle(sql, item);
    }
  }

  async cleanup(init = false) {
    for (const outPath of this.outPaths) {
      const parentFolder = basename(dirname(outPath));
      if (!parentFolder.startsWith("sql-dump"))
        throw new Error(
          `sql-dump out dir must begins with 'sql-dump': ${outPath}`,
        );
      if (existsSync(outPath)) await rm(outPath, { recursive: true });
      if (!init) this.outPaths.delete(outPath);
    }
  }

  protected async runSingle(
    sql: Awaited<ReturnType<typeof createMysqlCli>>,
    item: MySQLDumpItem,
  ) {
    let error: Error | undefined;
    const tables = await this.fetchTables(item.database, (db) =>
      sql.fetchTableNames(db),
    );
    const now = Date.now();
    const stats = { files: 0, bytes: 0 };
    const outs =
      typeof item.out === "string"
        ? [{ path: item.out, tables: ["*"] }]
        : item.out;

    const items = tables
      .map((table) => {
        const out = outs.find((o) => match(table, o.tables));
        return (
          !!out &&
          !!out.path && {
            table,
            out: `${out.path}/${table}.sql`,
          }
        );
      })
      .filter((o) => !!o);

    for (const item of items) this.outPaths.add(dirname(item.out));

    await this.cleanup(true);

    try {
      await runParallel({
        items,
        concurrency: this.options.concurrency ?? 1,
        onItem: async (data) => {
          const output = data.item.out;
          const outDir = dirname(output);
          await mkdir(outDir, { recursive: true });
          if (this.options.minFreeSpace)
            await ensureFreeDiskSpace(
              await fetchDiskStats(outDir),
              this.options.minFreeSpace,
            );
          await sql.dump({
            database: item.database,
            items: [data.item.table],
            output,
          });

          const infoFile = await stat(output);
          stats.files++;
          stats.bytes += infoFile.size;
        },
      });
    } catch (inError) {
      error = inError as Error;
    }

    this.processes.push({
      name: item.name,
      error,
      stats,
    });

    await this.ntfy.send(
      `SQL dump`,
      {
        "- Package": item.name,
        "- Size": formatBytes(stats.bytes),
        "- Files": stats.files,
        "- Duration": duration(Date.now() - now),
        "- Error": error?.message,
      },
      error,
    );
  }
}
