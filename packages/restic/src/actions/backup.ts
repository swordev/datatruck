import { createRunner, safeRun } from "../utils/async.js";
import { checkDiskSpace, fetchMultipleDiskStats } from "../utils/fs.js";
import { MySQLDump } from "../utils/mysql.js";
import { Action } from "./base.js";
import { Prune } from "./prune.js";
import { ResticRepository } from "@datatruck/cli/repositories/ResticRepository.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { isLocalDir } from "@datatruck/cli/utils/fs.js";
import { progressPercent } from "@datatruck/cli/utils/math.js";
import { Restic } from "@datatruck/cli/utils/restic.js";
import { match } from "@datatruck/cli/utils/string.js";
import { randomUUID } from "crypto";
import { hostname } from "os";

export type BackupOptions = {
  packages?: string[];
  repositories?: string[];
  prune?: boolean;
};

export type CommonResticBackupTags = {
  id: string;
  shortId: string;
  hostname: string;
  date: string;
  vendor: string;
  version: string;
};

export type ResticBackupTags = CommonResticBackupTags & {
  package: string;
  tags?: string[];
};

export class Backup extends Action {
  protected async runSingle(
    repoName: string,
    pkgName: string,
    tags: CommonResticBackupTags,
  ) {
    const repo = this.cm.findRepository(repoName);
    const pkg = this.cm.findPackage(pkgName);
    const restic = new Restic({
      log: this.verbose,
      env: {
        RESTIC_PASSWORD: repo.password,
        RESTIC_REPOSITORY: repo.uri,
      },
    });
    let space: { diff: number; size: number } | undefined;
    let bytes = 0;
    let files = 0;

    return await createRunner(async () => {
      await restic.tryInit();
      const targetPath = isLocalDir(repo.uri) ? repo.uri : undefined;
      space = await checkDiskSpace({
        minFreeSpace: this.config.minFreeSpace,
        minFreeSpacePath: targetPath ?? process.cwd(),
        targetPath,
        rutine: () => {
          const pkgTags: ResticBackupTags = {
            ...tags,
            package: pkg.name,
            tags: [],
          };
          return restic.backup({
            tags: ResticRepository.createSnapshotTags(pkgTags as any),
            paths: [pkg.path],
            exclude: pkg.exclude,
            onStream(data) {
              if (data.message_type === "summary") {
                files = data.total_files_processed;
                bytes = data.total_bytes_processed;
              }
            },
          });
        },
      });
    }).start(async (data) => {
      await this.ntfy.send(
        "Backup",
        {
          Repository: repo.name,
          Package: pkg.name,
          Size:
            formatBytes(bytes) +
            (space !== undefined ? ` (${formatBytes(space.diff, true)})` : ""),
          Files: files,
          Duration: data.duration,
          Error: data.error?.message,
        },
        data.error,
      );

      return {
        error: data.error,
        files,
        bytes,
        diffSize: space?.diff,
      };
    });
  }

  protected filterTasks(packageNames: string[]) {
    return this.config.tasks?.filter(
      (task) =>
        task.type === "mysql-dump" &&
        task.packages.some((pattern) => match(pattern, packageNames)),
    );
  }

  async run(options: BackupOptions = {}) {
    const sqlDumps: MySQLDump[] = [];
    const backups: {
      pkgName: string;
      error: Error | undefined;
      diffSize: number | undefined;
      bytes: number;
      files: number;
    }[] = [];
    let localRepositoryPaths: string[] = [];

    await createRunner(async () => {
      const repositories = this.cm.filterRepositories(options.repositories);
      const packages = this.cm.filterPackages(options.packages);
      const packageNames = packages.map((p) => p.name);
      const tasks = this.filterTasks(packageNames);

      await this.ntfy.send(`Backup start`, {
        Repositories: repositories.length,
        Packages: packageNames.length,
        Tasks: tasks?.length,
      });

      localRepositoryPaths = repositories
        .filter((repo) => isLocalDir(repo.uri))
        .map((repo) => repo.uri);

      const tags: CommonResticBackupTags = {
        id: randomUUID().replaceAll("-", ""),
        get shortId() {
          return this.id.slice(0, 8);
        },
        hostname: this.config.hostname ?? hostname(),
        date: new Date().toISOString(),
        vendor: "dtt-restic",
        version: "1",
      };

      for (const task of tasks ?? []) {
        if (task.type === "mysql-dump") {
          const mysqlDump = new MySQLDump(
            {
              minFreeSpace: this.config.minFreeSpace,
              verbose: this.verbose,
              name: task.name,
              connection: task.config.connection,
              concurrency: task.config.concurrency,
            },
            this.ntfy,
          );

          sqlDumps.push(mysqlDump);

          await mysqlDump.run({
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
          });
        }
      }

      for (const repo of repositories) {
        for (const pkg of packages) {
          const result = await this.runSingle(repo.name, pkg.name, tags);
          backups.push({
            pkgName: pkg.name,
            ...result,
          });
        }
      }
    }).start(async (data) => {
      for (const sqlDump of sqlDumps) await sqlDump.cleanup();

      const summary = backups.reduce(
        (acc, p) => {
          if (!acc[p.pkgName])
            acc[p.pkgName] = {
              name: p.pkgName,
              total: 0,
              success: 0,
              errors: 0,
              bytes: 0,
            };
          const group = acc[p.pkgName];
          group.total++;
          group.bytes += p.bytes;
          group[p.error ? "errors" : "success"]++;
          return acc;
        },
        {} as Record<
          string,
          {
            name: string;
            total: number;
            success: number;
            errors: number;
            bytes: number;
          }
        >,
      );

      const backupsValues = Object.values(summary);
      const sqlDumpProcesses = sqlDumps.flatMap((sql) => sql.processes);
      const error =
        !!data.error ||
        sqlDumpProcesses.some((p) => p.error) ||
        backupsValues.some((p) => p.errors);

      const size = [
        ...sqlDumpProcesses.map((p) => p.stats.bytes),
        ...backupsValues.map((b) => b.bytes),
      ].reduce((r, b) => r + b, 0);

      const diskStats = await safeRun(() =>
        fetchMultipleDiskStats(localRepositoryPaths),
      );

      if (diskStats.error) console.error(diskStats.error);

      await this.ntfy.send(
        "Backup end",
        {
          Duration: data.duration,
          Size: formatBytes(size),
          Error: data.error?.message,
          "": [
            !!diskStats.result?.length && { key: "Disk stats", value: "" },
            ...(diskStats.result?.map((p) => ({
              key: p.name,
              value: `${formatBytes(p.free)}/${formatBytes(p.total)} (${progressPercent(p.total, p.free)}%)`,
              level: 1,
            })) || []),
            !!sqlDumpProcesses.length && { key: "SQL Dumps", value: "" },
            ...sqlDumpProcesses.map((p) => ({
              key: p.name,
              value: formatBytes(p.stats.bytes),
              level: 1,
            })),
            !!backupsValues.length && { key: "Packages", value: "" },
            ...backupsValues.map((p) => ({
              key: p.name,
              value: `${p.success}/${p.total}`,
              level: 1,
            })),
          ],
        },
        error,
      );

      if (options.prune) {
        await new Prune(this.config, this.global).run({
          packages: options.packages,
          repositories: options.repositories,
        });
      }
    });
  }
}
