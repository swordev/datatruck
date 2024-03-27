import { PreSnapshot } from "../repositories/RepositoryAbstract";
import { formatBytes } from "../utils/bytes";
import { renderError, renderListTaskItem, renderResult } from "../utils/cli";
import { DataFormat, DataFormatType } from "../utils/data-format";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../utils/datatruck/config";
import type { Config, PackageConfig } from "../utils/datatruck/config-type";
import {
  ReportListTaskContext,
  createReportListTasks,
} from "../utils/datatruck/report-list";
import { createAndInitRepo } from "../utils/datatruck/repository";
import { createTask } from "../utils/datatruck/task";
import { duration } from "../utils/date";
import { AppError } from "../utils/error";
import { ensureExistsDir } from "../utils/fs";
import { Listr3, Listr3TaskResultEnd } from "../utils/list";
import { pickProps } from "../utils/object";
import { InferOptions, OptionsConfig } from "../utils/options";
import { Progress, ProgressManager, ProgressMode } from "../utils/progress";
import { StdStreams } from "../utils/stream";
import { GargabeCollector, ensureFreeDiskTempSpace } from "../utils/temp";
import { PruneAction } from "./PruneAction";
import { snapshotsActionOptions } from "./SnapshotsAction";
import { ok } from "assert";
import chalk from "chalk";
import { randomUUID } from "crypto";
import dayjs from "dayjs";
import { hostname } from "os";

type Context = {
  snapshot: { id: string };
  task: { taskName: string; packageName: string };
  backup: { packageName: string; repositoryName: string; bytes: number };
  cleanup: {};
  copy: {
    packageName: string;
    repositoryName: string;
    mirrorRepositoryName: string;
    bytes: number;
  };
  prune: { packageName: string; total: number; pruned: number };
} & ReportListTaskContext;

export const backupActionOptions = {
  ...pickProps(snapshotsActionOptions, {
    repositoryNames: true,
    repositoryTypes: true,
    packageNames: true,
    packageTaskNames: true,
    tags: true,
  }),
  dryRun: {
    description: "Skip execution",
    option: "--dryRun",
    boolean: true,
  },
  date: {
    description: "Date time (ISO)",
    option: "--date <value>",
  },
  prune: {
    description: "Prune backups",
    option: "--prune",
    boolean: true,
  },
} satisfies OptionsConfig;

export type BackupActionOptions = InferOptions<typeof backupActionOptions> & {
  verbose?: boolean;
};

export class BackupAction {
  constructor(
    readonly config: Config,
    readonly options: BackupActionOptions,
    readonly settings: {
      tty?: "auto" | boolean;
      progress?: ProgressMode;
      streams?: StdStreams;
    },
  ) {}

  protected prepareSnapshot(): PreSnapshot {
    const date = this.options.date ?? new Date().toISOString();
    if (!dayjs(date, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", true).isValid())
      throw new AppError(`Invalid snapshot date: ${date}`);
    return {
      id: randomUUID().replaceAll("-", ""),
      date,
    };
  }
  protected getPackages(snapshot: PreSnapshot): PackageConfig[] {
    const packages = filterPackages(this.config, {
      packageNames: this.options.packageNames,
      packageTaskNames: this.options.packageTaskNames,
      repositoryNames: this.options.repositoryNames,
      repositoryTypes: this.options.repositoryTypes,
      sourceAction: "backup",
    });

    return resolvePackages(packages, {
      snapshotId: snapshot.id,
      snapshotDate: snapshot.date,
      action: "backup",
    }) as PackageConfig[];
  }

  protected getRepositoryNames(repositoryNames: string[]) {
    const items: { name: string; mirrors: string[] }[] = [];
    const exclude = new Set<string>();
    for (const name of repositoryNames) {
      const repo = findRepositoryOrFail(this.config, name);
      const mirrors = (repo.mirrorRepoNames || []).filter(
        (mirror) => !exclude.has(mirror),
      );
      for (const mirror of mirrors) exclude.add(mirror);
      items.push({ name, mirrors });
    }
    return items.filter((item) => !exclude.has(item.name));
  }

  protected async backup(data: {
    repositoryName: string;
    snapshot: PreSnapshot;
    snapshotPath: string | undefined;
    pkg: PackageConfig;
    onProgress: (data: Progress) => void;
  }) {
    const repoConfig = findRepositoryOrFail(this.config, data.repositoryName);
    const pkg = { ...data.pkg, path: data.snapshotPath ?? data.pkg.path };
    ok(pkg.path);
    await ensureExistsDir(pkg.path);
    const repo = await createAndInitRepo(repoConfig, this.options.verbose);
    if (this.config.minFreeDiskSpace)
      await repo.ensureFreeDiskSpace(
        repoConfig.config,
        this.config.minFreeDiskSpace,
      );
    const packageConfig = pkg.repositoryConfigs?.find(
      (config) =>
        config.type === repoConfig.type &&
        (!config.names || config.names.includes(repoConfig.name)),
    )?.config;
    return await repo.backup({
      options: this.options,
      snapshot: data.snapshot,
      hostname: this.config.hostname ?? hostname(),
      package: pkg as any,
      packageConfig,
      onProgress: data.onProgress,
    });
  }

  protected async copy(data: {
    repositoryName: string;
    mirrorRepositoryName: string;
    snapshot: PreSnapshot;
    pkg: PackageConfig;
    onProgress: (data: Progress) => void;
  }) {
    const repoConfig = findRepositoryOrFail(this.config, data.repositoryName);
    const mirrorRepoConfig = findRepositoryOrFail(
      this.config,
      data.mirrorRepositoryName,
    );
    const repo = await createAndInitRepo(repoConfig, this.options.verbose);
    const mirrorRepo = await createAndInitRepo(
      mirrorRepoConfig,
      this.options.verbose,
    );
    if (this.config.minFreeDiskSpace)
      await mirrorRepo.ensureFreeDiskSpace(
        mirrorRepoConfig.config,
        this.config.minFreeDiskSpace,
      );
    return await repo.copy({
      options: this.options,
      package: data.pkg,
      snapshot: data.snapshot,
      mirrorRepositoryConfig: mirrorRepoConfig.config,
      onProgress: data.onProgress,
    });
  }

  dataFormat(
    result: Listr3TaskResultEnd<Context>[],
    options: {
      streams?: StdStreams;
      verbose?: number;
      errors?: Error[];
    } = {},
  ) {
    const renderTitle = (
      item: Listr3TaskResultEnd<Context>,
      color?: boolean,
    ) => {
      let title = item.key.slice(0, 1).toUpperCase() + item.key.slice(1);
      return item.key === "backup" && color ? chalk.cyan(title) : title;
    };
    const renderData = (
      item: Listr3TaskResultEnd<Context>,
      result: Listr3TaskResultEnd<Context>[],
      format: DataFormatType,
    ) => {
      const color = format !== "list";
      const g = (v: string) => (color ? `${chalk.gray(`(${v})`)}` : `(${v})`);
      return renderListTaskItem(item, color, {
        snapshot: (data) => data.id,
        task: (data) => [data.packageName, data.taskName],
        backup: (data) => [
          data.packageName,
          g([data.repositoryName, formatBytes(data.bytes)].join(" ")),
        ],
        copy: (data) => [
          data.packageName,
          g([data.mirrorRepositoryName, formatBytes(data.bytes)].join(" ")),
        ],
        prune: (data) => [data.packageName, g(`${data.pruned}/${data.total}`)],
        cleanup: () => "",
        report: (data) => data.type,
        summary: (data) => ({
          errors: data.errors,
          backups: result.filter((r) => !r.error && r.key === "backup").length,
          copies: result.filter((r) => !r.error && r.key === "copy").length,
          prunes: result
            .filter((r) => !r.error && r.key === "prune")
            .reduce((result, item) => {
              if (item.key === "prune") result += item.data.pruned;
              return result;
            }, 0),
          ...(format === "list" && {
            duration: duration(item.elapsed),
          }),
        }),
      });
    };

    return new DataFormat({
      streams: options.streams,
      json: result,
      list: () =>
        result
          .filter((item) => item.key !== "cleanup")
          .map((item) => {
            const icon = renderResult(item.error, false);
            const title = renderTitle(item);
            const data = renderData(item, result, "list");
            return `${icon} ${title}: ${data}`;
          }),
      table: {
        headers: [
          { value: "", width: 3 },
          { value: "Title", width: 15 },
          { value: "Data", align: "left" },
          { value: "Duration", width: 10 },
          { value: "Error", width: 50 },
        ],
        rows: () => {
          return result
            .filter((item) => item.key !== "cleanup")
            .map((item) => [
              renderResult(item.error),
              renderTitle(item, true),
              renderData(item, result, "table"),
              duration(item.elapsed),
              renderError(item.error, options.errors?.indexOf(item.error!)),
            ]);
        },
      },
    });
  }
  async exec() {
    const { options, settings } = this;
    const gc = new GargabeCollector();
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: settings.tty,
      mode: settings.progress,
    });
    const l = new Listr3<Context>({
      streams: settings.streams,
      progressManager: pm,
      gargabeCollector: gc,
    });
    return l
      .add([
        l.$task({
          key: "snapshot",
          data: { id: "" },
          exitOnError: false,
          title: {
            initial: "Prepare snapshots",
            started: "Preparing snapshots",
            failed: "Snapshots prepare failed",
          },
          run: async (task, data) => {
            const { minFreeDiskSpace } = this.config;
            if (minFreeDiskSpace)
              await ensureFreeDiskTempSpace(minFreeDiskSpace);
            const snapshot = this.prepareSnapshot();
            const packages = this.getPackages(snapshot);
            const snapshotId = (data.id = snapshot.id.slice(0, 8));
            task.title = `Snapshots prepared: ${snapshotId} (${packages.length} packages)`;

            return [
              ...packages.flatMap((pkg) => {
                let taskResult: { snapshotPath?: string } | undefined = {};
                const repositories = this.getRepositoryNames(
                  pkg.repositoryNames ?? [],
                );
                const mirrorRepositories = repositories
                  .filter((r) => r.mirrors.length)
                  .flatMap(({ name, mirrors }) =>
                    mirrors.map((mirror) => ({ name, mirror })),
                  );

                const taskGc = gc.create();
                return l.$tasks(
                  !!pkg.task &&
                    l.$task({
                      key: "task",
                      keyIndex: pkg.name,
                      data: { taskName: pkg.task.name, packageName: pkg.name },
                      title: {
                        initial: `Execute task: ${pkg.name} (${pkg.task.name})`,
                        started: `Executing task: ${pkg.name} (${pkg.task.name})`,
                        failed: `Task execute failed: ${pkg.name} (${pkg.task.name})`,
                        completed: `Task executed: ${pkg.name} (${pkg.task.name})`,
                      },
                      exitOnError: false,
                      run: async (task) => {
                        await taskGc.disposeIfFail(async () => {
                          using progress = pm.create(task);
                          taskResult = await createTask(pkg.task!).backup({
                            options: this.options,
                            package: pkg,
                            snapshot,
                            onProgress: progress.update,
                          });
                        });
                      },
                    }),
                  ...repositories.map(({ name: repositoryName }) =>
                    l.$task({
                      key: "backup",
                      keyIndex: [pkg.name, repositoryName],
                      data: {
                        packageName: pkg.name,
                        repositoryName: repositoryName,
                        bytes: 0,
                      },
                      title: {
                        initial: `Create backup: ${pkg.name} (${repositoryName})`,
                        started: `Creating backup: ${pkg.name} (${repositoryName})`,
                        completed: `Backup created: ${pkg.name} (${repositoryName})`,
                        failed: `Backup create failed: ${pkg.name} (${repositoryName})`,
                      },
                      exitOnError: false,
                      run: async (task, data) => {
                        await using _ = gc.create().disposeOnFinish();
                        const taskSummary = pkg.task
                          ? l.result("task", pkg.name)
                          : undefined;
                        if (taskSummary?.error)
                          throw new AppError(`Task failed`);
                        using progress = pm.create(task);
                        const backup = await this.backup({
                          pkg,
                          repositoryName,
                          snapshot,
                          snapshotPath: taskResult?.snapshotPath,
                          onProgress: progress.update,
                        });
                        data.bytes = backup.bytes;
                      },
                    }),
                  ),
                  l.$task({
                    key: "cleanup",
                    keyIndex: pkg.name,
                    data: {},
                    title: {
                      initial: "Clean task files",
                      started: "Cleaning task files",
                      completed: "Task files cleaned",
                      failed: "Task files clean failed",
                    },
                    exitOnError: false,
                    enabled: taskGc.pending(),
                    run: () => taskGc.dispose(),
                  }),
                  ...mirrorRepositories.map(({ name, mirror }) =>
                    l.$task({
                      key: "copy",
                      keyIndex: [pkg.name, mirror],
                      data: {
                        packageName: pkg.name,
                        repositoryName: name,
                        mirrorRepositoryName: mirror,
                        bytes: 0,
                      },
                      title: {
                        initial: `Copy snapshot: ${pkg.name} (${mirror})`,
                        started: `Copying snapshot: ${pkg.name} (${mirror})`,
                        completed: `Snapshot copied: ${pkg.name} (${mirror})`,
                        failed: `Snapshot copy failed: ${pkg.name} (${mirror})`,
                      },
                      exitOnError: false,
                      run: async (task, data) => {
                        await using _ = gc.create().disposeOnFinish();
                        const backupSummary = l.result("backup", [
                          pkg.name,
                          name,
                        ]);
                        if (backupSummary.error)
                          throw new AppError(`Backup failed`);
                        using progress = pm.create(task);
                        const copy = await this.copy({
                          repositoryName: name,
                          mirrorRepositoryName: mirror,
                          pkg,
                          snapshot,
                          onProgress: progress.update,
                        });
                        data.bytes = copy.bytes;
                      },
                    }),
                  ),
                  !!this.options.prune &&
                    l.$task({
                      title: {
                        initial: `Prune: ${pkg.name}`,
                        started: `Pruning: ${pkg.name}`,
                        completed: `Pruned: ${pkg.name}`,
                        failed: `Prune failed: ${pkg.name}`,
                      },
                      exitOnError: false,
                      key: "prune",
                      keyIndex: [pkg.name],
                      data: {
                        pruned: 0,
                        total: 0,
                        packageName: pkg.name,
                      },
                      run: async (_, data) => {
                        const prune = new PruneAction(this.config, {
                          repositoryNames: this.options.repositoryNames,
                          repositoryTypes: this.options.repositoryTypes as any,
                          packageNames: [pkg.name],
                          groupBy: ["packageName", "repositoryName"],
                        });
                        const result = await prune.exec();
                        data.total = result.total;
                        data.pruned = result.prune;
                      },
                    }),
                );
              }),
              ...createReportListTasks(l, {
                hostname: this.config.hostname ?? hostname(),
                action: "backup",
                reports: this.config.reports || [],
                verbose: this.options.verbose,
                onMessage: (result, report) =>
                  this.dataFormat(result).format(report.format ?? "list"),
              }),
            ];
          },
        }),
      ])
      .execAndParse(this.options.verbose);
  }
}
