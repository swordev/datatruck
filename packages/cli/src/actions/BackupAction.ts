import { PreSnapshot } from "../repositories/RepositoryAbstract";
import { DataFormat } from "../utils/DataFormat";
import { renderError, renderObject, renderResult } from "../utils/cli";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../utils/datatruck/config";
import type {
  Config,
  PackageConfig,
  RepositoryConfig,
} from "../utils/datatruck/config-type";
import { createRepo } from "../utils/datatruck/repository";
import { createTask } from "../utils/datatruck/task";
import { duration } from "../utils/date";
import { ensureExistsDir } from "../utils/fs";
import { Listr3, Listr3TaskResultEnd } from "../utils/list";
import { Progress, ProgressManager, ProgressMode } from "../utils/progress";
import { isReportStep, runReportSteps } from "../utils/reportSteps";
import { isSpawnStep, runSpawnSteps } from "../utils/spawnSteps";
import { Streams } from "../utils/stream";
import { GargabeCollector, ensureFreeDiskTempSpace } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import { PruneAction } from "./PruneAction";
import { ok } from "assert";
import chalk from "chalk";
import { randomUUID } from "crypto";
import dayjs from "dayjs";

export type BackupActionOptions = {
  repositoryNames?: string[];
  repositoryTypes?: RepositoryConfig["type"][];
  packageNames?: string[];
  packageTaskNames?: string[];
  tags?: string[];
  dryRun?: boolean;
  verbose?: boolean;
  date?: string;
  tty?: "auto" | boolean;
  progress?: ProgressMode;
  streams?: Streams;
  prune?: boolean;
};

type Context = {
  snapshot: { id: string };
  task: { taskName: string; packageName: string };
  backup: { packageName: string; repositoryName: string };
  cleanup: {};
  copy: {
    packageName: string;
    repositoryName: string;
    mirrorRepositoryName: string;
  };
  prune: { packageName: string; total: number; pruned: number };
  report: { type: string };
};

export class BackupAction<TRequired extends boolean = true> {
  constructor(
    readonly config: Config,
    readonly options: IfRequireKeys<TRequired, BackupActionOptions> = {} as any,
  ) {}

  protected prepareSnapshot(): PreSnapshot {
    const date = this.options.date ?? new Date().toISOString();
    if (!dayjs(date, "YYYY-MM-DDTHH:mm:ss.SSS[Z]", true).isValid())
      throw new Error(`Invalid snapshot date: ${date}`);
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
    const repo = createRepo(repoConfig);
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
    await repo.backup({
      options: this.options,
      snapshot: data.snapshot,
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
    const repo = createRepo(repoConfig);
    const mirrorRepo = createRepo(mirrorRepoConfig);
    if (this.config.minFreeDiskSpace)
      await mirrorRepo.ensureFreeDiskSpace(
        mirrorRepoConfig.config,
        this.config.minFreeDiskSpace,
      );
    await repo.copy({
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
      streams?: Streams;
      verbose?: number;
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
      color?: boolean,
      result: Listr3TaskResultEnd<Context>[] = [],
    ) => {
      const g = (v: string) => (color ? `${chalk.gray(`(${v})`)}` : `(${v})`);
      return item.key === "prune"
        ? `${item.data.packageName} ${g(
            `${item.data.pruned}/${item.data.total}`,
          )}`
        : item.key === "snapshot"
          ? item.data.id
          : item.key === "task"
            ? `${item.data.packageName} ${g(item.data.taskName)}`
            : item.key === "backup"
              ? `${item.data.packageName} ${g(item.data.repositoryName)}`
              : item.key === "copy"
                ? `${item.data.packageName} ${g(
                    item.data.mirrorRepositoryName,
                  )}`
                : item.key === "summary"
                  ? renderObject(
                      {
                        errors: item.data.errors,
                        backups: result.filter(
                          (r) => !r.error && r.key === "backup",
                        ).length,
                        copies: result.filter(
                          (r) => !r.error && r.key === "copy",
                        ).length,
                        prunes: result
                          .filter((r) => !r.error && r.key === "prune")
                          .reduce((result, item) => {
                            if (item.key === "prune")
                              result += item.data.pruned;
                            return result;
                          }, 0),
                      },
                      color,
                    )
                  : item.key === "report"
                    ? item.data.type
                    : "";
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
            const data = renderData(item, false, result);
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
        rows: () =>
          result
            .filter((item) => item.key !== "cleanup")
            .map((item) => [
              renderResult(item.error),
              renderTitle(item, true),
              renderData(item, true, result),
              duration(item.elapsed),
              renderError(item.error, options.verbose),
            ]),
      },
    });
  }
  async exec() {
    const { options } = this;
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: options.tty,
      mode: options.progress,
    });
    const l = new Listr3<Context>({
      streams: this.options.streams,
      progressManager: pm,
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
                const gc = new GargabeCollector();
                const repositories = this.getRepositoryNames(
                  pkg.repositoryNames ?? [],
                );
                const mirrorRepositories = repositories
                  .filter((r) => r.mirrors.length)
                  .flatMap(({ name, mirrors }) =>
                    mirrors.map((mirror) => ({ name, mirror })),
                  );

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
                      runWrapper: gc.cleanupIfFail.bind(gc),
                      run: async (task) => {
                        taskResult = await createTask(pkg.task!).backup({
                          options,
                          package: pkg,
                          snapshot,
                          onProgress: (p) =>
                            pm.update(p, (t) => (task.output = t)),
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
                      },
                      title: {
                        initial: `Create backup: ${pkg.name} (${repositoryName})`,
                        started: `Creating backup: ${pkg.name} (${repositoryName})`,
                        completed: `Backup created: ${pkg.name} (${repositoryName})`,
                        failed: `Backup create failed: ${pkg.name} (${repositoryName})`,
                      },
                      exitOnError: false,
                      runWrapper: gc.cleanupOnFinish.bind(gc),
                      run: async (task) => {
                        const taskSummary = pkg.task
                          ? l.result("task", pkg.name)
                          : undefined;
                        if (taskSummary?.error) throw new Error(`Task failed`);
                        await this.backup({
                          pkg,
                          repositoryName,
                          snapshot,
                          snapshotPath: taskResult?.snapshotPath,
                          onProgress: (p) =>
                            pm.update(p, (t) => (task.output = t)),
                        });
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
                    enabled: gc.pending,
                    run: () => gc.cleanup(),
                  }),
                  ...mirrorRepositories.map(({ name, mirror }) =>
                    l.$task({
                      key: "copy",
                      keyIndex: [pkg.name, mirror],
                      data: {
                        packageName: pkg.name,
                        repositoryName: name,
                        mirrorRepositoryName: mirror,
                      },
                      title: {
                        initial: `Copy snapshot: ${pkg.name} (${mirror})`,
                        started: `Copying snapshot: ${pkg.name} (${mirror})`,
                        completed: `Snapshot copied: ${pkg.name} (${mirror})`,
                        failed: `Snapshot copy failed: ${pkg.name} (${mirror})`,
                      },
                      exitOnError: false,
                      runWrapper: gc.cleanup.bind(gc),
                      run: async (task) => {
                        const backupSummary = l.result("backup", [
                          pkg.name,
                          name,
                        ]);
                        if (backupSummary.error)
                          throw new Error(`Backup failed`);
                        await this.copy({
                          repositoryName: name,
                          mirrorRepositoryName: mirror,
                          pkg,
                          snapshot,
                          onProgress: (p) =>
                            pm.update(p, (t) => (task.output = t)),
                        });
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
                        const prune = new PruneAction<false>(this.config, {
                          repositoryNames: this.options.repositoryNames,
                          repositoryTypes: this.options.repositoryTypes,
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
              ...(this.config.reports || []).map((report, index) => {
                const reportIndex = index + 1;
                return l.$task({
                  title: {
                    initial: `Send report ${reportIndex}`,
                    started: `Sending report ${reportIndex}`,
                    completed: `Report sent: ${reportIndex}`,
                    failed: `Report send failed: ${reportIndex}`,
                  },
                  key: "report",
                  keyIndex: index,
                  data: { type: report.run.type },
                  exitOnError: false,
                  run: async (task) => {
                    const result = l
                      .getResult()
                      .filter((r) => r.key !== "report");
                    const success = result.every((r) => !r.error);
                    const enabled =
                      !report.when ||
                      (report.when === "success" && success) ||
                      (report.when === "error" && !success);

                    if (!enabled)
                      return task.skip(`Report send skipped: ${reportIndex}`);
                    const message = this.dataFormat(result).format(
                      report.format ?? "list",
                    );
                    if (isSpawnStep(report.run)) {
                      await runSpawnSteps(report.run, {
                        data: {
                          dtt: {
                            message,
                            result,
                            success,
                          },
                        },
                        verbose: this.options.verbose,
                      });
                    } else if (isReportStep(report.run)) {
                      await runReportSteps(report.run, {
                        data: {
                          title: "DTT Backup",
                          message,
                          success,
                        },
                      });
                    } else {
                      throw new Error(
                        `Invalid step type: ${(report.run as any).type}`,
                      );
                    }
                  },
                });
              }),
            ];
          },
        }),
      ])
      .exec();
  }
}
