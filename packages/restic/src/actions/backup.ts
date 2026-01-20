import { MySQLDump } from "../utils/mysql.js";
import {
  CommonResticBackupTags,
  ResticBackup,
} from "../utils/restic-backup.js";
import { Action } from "./base.js";
import { Prune } from "./prune.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { duration } from "@datatruck/cli/utils/date.js";
import { match } from "@datatruck/cli/utils/string.js";
import { randomUUID } from "crypto";
import { hostname } from "os";

export type BackupRunOptions = {
  packages?: string[];
  repositories?: string[];
  prune?: boolean;
};

export class Backup extends Action {
  protected tags!: CommonResticBackupTags;
  protected createInstances(
    packageNames: string[],
    repositoryNames?: string[],
  ) {
    const repositories = this.cm.filterRepositories(repositoryNames).map(
      (repo) =>
        new ResticBackup(
          {
            tags: this.tags,
            minFreeSpace: this.config.minFreeSpace,
            name: repo.name,
            connection: {
              password: repo.password,
              uri: repo.uri,
            },
          },
          this.ntfy,
          this.verbose,
        ),
    );

    const sqlDumps =
      this.config.tasks
        ?.filter(
          (task) =>
            task.type === "mysql-dump" &&
            task.packages.some((name) => match(name, packageNames)),
        )
        .map(
          (task) =>
            [
              new MySQLDump(
                {
                  minFreeSpace: this.config.minFreeSpace,
                  verbose: this.verbose,
                  name: task.name,
                  connection: task.config.connection,
                  concurrency: task.config.concurrency,
                },
                this.ntfy,
              ),
              task,
            ] as const,
        ) ?? [];

    return { repositories, sqlDumps };
  }

  async run(options: BackupRunOptions = {}) {
    this.tags = {
      id: randomUUID().replaceAll("-", ""),
      get shortId() {
        return this.id.slice(0, 8);
      },
      hostname: this.config.hostname ?? hostname(),
      date: new Date().toISOString(),
      vendor: "dtt-restic",
      version: "1",
    };

    const now = Date.now();
    const packages = this.cm.filterPackages(options.packages);
    const packageNames = packages.map((p) => p.name);

    const { sqlDumps, repositories } = this.createInstances(
      packageNames,
      options.repositories,
    );

    let fatalError: Error | undefined;
    try {
      await this.ntfy.send(`Backup start`, {
        "- Packages": packageNames.length,
      });
      if (!packages.length) throw new Error("None package found");
      for (const [sqlDump, task] of sqlDumps) {
        await sqlDump.run([
          {
            database: task.config.database,
            name: task.name,
            out:
              typeof task.config.out === "string"
                ? task.config.out
                : task.config.out.map((o) => ({
                    tables: o.tables,
                    path:
                      !o.package || match(o.package, packageNames)
                        ? o.path
                        : false,
                  })),
          },
        ]);
      }
      for (const backup of repositories) await backup.run(packages);
    } catch (inError) {
      fatalError = inError as Error;
    } finally {
      for (const [sqlDump] of sqlDumps) await sqlDump.cleanup();
      const backupSummary: Record<
        string,
        {
          name: string;
          total: number;
          success: number;
          errors: number;
          bytes: number;
        }
      > = {};

      for (const repo of repositories) {
        for (const process of repo.processes) {
          if (!backupSummary[process.name])
            backupSummary[process.name] = {
              name: process.name,
              total: 0,
              success: 0,
              errors: 0,
              bytes: 0,
            };
          backupSummary[process.name].total++;
          backupSummary[process.name].bytes += process.stats.bytes;
          if (process.error) {
            backupSummary[process.name].errors++;
          } else {
            backupSummary[process.name].success++;
          }
        }
      }

      const backups = Object.values(backupSummary);
      const sqlDumpProccesses = sqlDumps.flatMap(([sql]) => sql.processes);
      const error =
        !!fatalError ||
        sqlDumpProccesses.some((p) => p.error) ||
        backups.some((p) => p.errors);

      const size = [
        ...sqlDumpProccesses.map((p) => p.stats.bytes),
        ...backups.map((b) => b.bytes),
      ].reduce((r, b) => r + b, 0);

      await this.ntfy.send(
        `Backup end`,
        [
          `- Duration: ${duration(Date.now() - now)}`,
          `- Size: ${formatBytes(size)}`,
          !!fatalError && `- Fatal error: ${fatalError.message}`,
          !!sqlDumpProccesses.length && "## SQL Dumps",
          ...sqlDumpProccesses.map(
            (p) =>
              `- ${p.error ? `❌ ` : ""}${p.name}: ${formatBytes(p.stats.bytes)}`,
          ),
          !!backups.length && "## Backups",
          ...backups.map(
            (p) =>
              `- ${p.errors ? `❌ ` : ""}${p.name}: ${p.success}/${p.total}`,
          ),
        ],
        error,
      );

      if (options.prune) {
        await new Prune(this.config, this.global).run({
          packages: options.packages,
          repositories: options.repositories,
        });
      }
    }
  }
}
