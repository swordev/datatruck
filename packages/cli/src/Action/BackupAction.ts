import type { ConfigType } from "../Config/Config";
import { PackageConfigType } from "../Config/PackageConfig";
import { createRepo } from "../Factory/RepositoryFactory";
import { createTask } from "../Factory/TaskFactory";
import { PreSnapshot } from "../Repository/RepositoryAbstract";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../utils/datatruck/config";
import { createTimer } from "../utils/date";
import { ensureExistsDir } from "../utils/fs";
import { Listr3 } from "../utils/list";
import { Progress, ProgressManager } from "../utils/progress";
import { GargabeCollector, ensureFreeDiskTempSpace } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import { ok } from "assert";
import { randomUUID } from "crypto";
import { ListrTask } from "listr2";

export type BackupActionOptions = {
  repositoryNames?: string[];
  repositoryTypes?: string[];
  packageNames?: string[];
  packageTaskNames?: string[];
  tags?: string[];
  dryRun?: boolean;
  verbose?: boolean;
  date?: string;
  tty?: "auto" | boolean;
  progress?: "auto" | "interval" | boolean;
  progressInterval?: number;
};

type PackageReport = {
  name: string;
  error?: Error;
  snapshots: {
    repositoryName: string;
    mirrorRepository: boolean;
    duration: number;
    error?: Error;
  }[];
};

type BackupReport = {
  snapshotId: string;
  duration: number;
  packages: PackageReport[];
};

export class BackupAction<TRequired extends boolean = true> {
  protected pm: ProgressManager;
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, BackupActionOptions> = {} as any,
  ) {
    this.pm = new ProgressManager({
      verbose: options.verbose,
      tty: options.tty,
      enabled: options.progress,
      interval: options.progressInterval,
    });
  }

  protected prepareSnapshot(): PreSnapshot {
    return {
      id: randomUUID().replaceAll("-", ""),
      date: this.options.date ?? new Date().toISOString(),
    };
  }
  protected getPackages(snapshot: PreSnapshot): PackageConfigType[] {
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
    }) as PackageConfigType[];
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
    pkg: PackageConfigType;
    gc: GargabeCollector;
    onProgress: (data: Progress) => void;
  }) {
    const repoConfig = findRepositoryOrFail(this.config, data.repositoryName);
    const pkg = { ...data.pkg, path: data.snapshotPath ?? data.pkg.path };
    ok(pkg.path);
    await ensureExistsDir(pkg.path);
    await data.gc.cleanupOnFinish(async () => {
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
    });
  }

  protected async copy(data: {
    repositoryName: string;
    mirrorRepositoryName: string;
    gc: GargabeCollector;
    snapshot: PreSnapshot;
    pkg: PackageConfigType;
    onProgress: (data: Progress) => void;
  }) {
    const repoConfig = findRepositoryOrFail(this.config, data.repositoryName);
    const mirrorRepoConfig = findRepositoryOrFail(
      this.config,
      data.mirrorRepositoryName,
    );
    await data.gc.cleanup(async () => {
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
    });
  }

  async exec() {
    let snapshot = this.prepareSnapshot();
    let packages = this.getPackages(snapshot);
    const { options } = this;
    const { minFreeDiskSpace } = this.config;
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: options.tty,
      enabled: options.progress,
      interval: options.progressInterval,
    });

    if (minFreeDiskSpace) await ensureFreeDiskTempSpace(minFreeDiskSpace);

    const report: BackupReport = {
      snapshotId: snapshot.id.slice(0, 8),
      duration: 0,
      packages: [],
    };

    return new Listr3({
      ctx: report,
      progressManager: pm,
      onAfterRun: () => (report.duration = pm.elapsed()),
    }).add([
      {
        title: `Snapshot: ${snapshot.id.slice(0, 8)}`,
        task: (_, task) => {},
      },
      {
        title: `Packages: ${packages.length}`,
        task: (_, task) => {
          return task.newListr(
            packages.map((pkg) => {
              return {
                title: `${pkg.name}`,
                exitOnError: false,
                task: (_, task) => {
                  let snapshotPath: string | undefined;
                  const gc = new GargabeCollector();
                  const repositories = this.getRepositoryNames(
                    pkg.repositoryNames ?? [],
                  );
                  const pkgReport: PackageReport = {
                    name: pkg.name,
                    snapshots: [],
                  };
                  report.packages.push(pkgReport);

                  return task.newListr([
                    {
                      enabled: !!pkg.task,
                      title: `Execute ${pkg.task?.name} task`,
                      task: async (_, listTask) => {
                        const timer = createTimer();
                        try {
                          await gc.cleanupIfFail(async () => {
                            const taskResult = await createTask(
                              pkg.task!,
                            ).backup({
                              options,
                              package: pkg,
                              snapshot,
                              onProgress: (p) =>
                                pm.update(p, (t) => (listTask.output = t)),
                            });
                            snapshotPath = taskResult?.snapshotPath;
                          });
                          listTask.title = `Task executed: ${pkg.task!.name}`;
                        } catch (error) {
                          pkgReport.error = error as Error;
                          listTask.title = `Task failed: ${pkg.task!.name}`;
                          throw error;
                        }
                      },
                    },
                    ...repositories.map(
                      ({ name: repositoryName }) =>
                        ({
                          title: `Create snapshot in ${repositoryName}`,
                          exitOnError: false,
                          task: async (_, task) => {
                            const timer = createTimer();
                            try {
                              await this.backup({
                                gc,
                                pkg,
                                repositoryName,
                                snapshot,
                                snapshotPath,
                                onProgress: (p) =>
                                  this.pm.update(p, (t) => (task.output = t)),
                              });
                              pkgReport.snapshots.push({
                                repositoryName,
                                mirrorRepository: false,
                                duration: timer.elapsed(),
                              });
                              task.title = `Snapshot created: ${repositoryName}`;
                            } catch (error) {
                              pkgReport.snapshots.push({
                                repositoryName,
                                mirrorRepository: false,
                                error: error as Error,
                                duration: timer.elapsed(),
                              });
                              task.title = `Snapshot failed: ${repositoryName}`;
                              throw error;
                            }
                          },
                        }) satisfies ListrTask,
                    ),
                    {
                      title: "Cleaning task files",
                      exitOnError: false,
                      enabled: gc.pending,
                      task: async () => await gc.cleanup(),
                    },
                    ...repositories
                      .filter((r) => r.mirrors.length)
                      .flatMap(({ name, mirrors }) =>
                        mirrors.map((mirror) => ({ name, mirror })),
                      )
                      .map(
                        ({ name, mirror }) =>
                          ({
                            title: `Copy snapshot to ${mirror}`,
                            exitOnError: false,
                            task: async (_, task) => {
                              const hasSnapshot = pkgReport.snapshots.find(
                                (s) => !s.error && s.repositoryName === name,
                              );
                              if (!hasSnapshot)
                                return task.skip(
                                  `Snapshot copy failed: ${mirror}`,
                                );
                              const timer = createTimer();
                              try {
                                await this.copy({
                                  repositoryName: name,
                                  mirrorRepositoryName: mirror,
                                  gc,
                                  pkg,
                                  snapshot,
                                  onProgress: (p) =>
                                    pm.update(p, (t) => (task.output = t)),
                                });
                                pkgReport.snapshots.push({
                                  repositoryName: mirror,
                                  mirrorRepository: true,
                                  duration: timer.elapsed(),
                                });
                                task.title = `Snapshot copied: ${mirror}`;
                              } catch (error) {
                                pkgReport.snapshots.push({
                                  repositoryName: mirror,
                                  mirrorRepository: true,
                                  error: error as Error,
                                  duration: timer.elapsed(),
                                });
                                task.title = `Snapshot copy failed: ${mirror}`;
                                throw error;
                              }
                            },
                          }) satisfies ListrTask,
                      ),
                  ]);
                },
              } satisfies ListrTask;
            }),
          );
        },
      },
    ]);
  }
}
