import type { ConfigType } from "../Config/Config";
import { PackageConfigType } from "../Config/PackageConfig";
import { createRepo } from "../Factory/RepositoryFactory";
import { createTask } from "../Factory/TaskFactory";
import { PreSnapshot } from "../Repository/RepositoryAbstract";
import { Listr3 } from "../utils/async";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../utils/datatruck/config";
import { ensureExistsDir } from "../utils/fs";
import { ProgressManager } from "../utils/progress";
import { GargabeCollector, ensureFreeDiskTempSpace } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import { ok } from "assert";
import { randomUUID } from "crypto";
import { ListrTask, PRESET_TIMER, PRESET_TIMESTAMP } from "listr2";

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

export class BackupAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, BackupActionOptions> = {} as any,
  ) {}

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

  protected splitRepositories(repositoryNames: string[]) {
    const mirrorRepoMap: Record<string, string[]> = {};
    const allMirrorRepoNames: string[] = [];
    const repoNames = repositoryNames ?? [];

    for (const repoName of repoNames) {
      const repo = findRepositoryOrFail(this.config, repoName);
      if (repo.mirrorRepoNames)
        mirrorRepoMap[repoName] = repo.mirrorRepoNames.filter(
          (mirrorRepoName) => {
            allMirrorRepoNames.push(mirrorRepoName);
            return repoNames.includes(mirrorRepoName);
          },
        );
    }

    return {
      repoNames: repoNames.filter((v) => !allMirrorRepoNames.includes(v)),
      mirrors: repoNames.flatMap((sourceName) => {
        const mirrorNames = mirrorRepoMap[sourceName] || [];
        return mirrorNames.map((name) => ({
          sourceName,
          name,
        }));
      }),
    };
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

    return new Listr3(
      [
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
                    const { repoNames, mirrors } = this.splitRepositories(
                      pkg.repositoryNames ?? [],
                    );

                    return task.newListr([
                      {
                        enabled: !!pkg.task,
                        title: `Executing ${pkg.task?.name} task`,
                        task: async (_, listTask) => {
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
                        },
                      },
                      ...repoNames.map(
                        (repoName) =>
                          ({
                            title: `Creating backup in ${repoName}`,
                            exitOnError: false,
                            task: async (_, task) => {
                              const repoConfig = findRepositoryOrFail(
                                this.config,
                                repoName,
                              );
                              pkg = {
                                ...pkg,
                                path: snapshotPath ?? pkg.path,
                              };
                              ok(pkg.path);
                              await ensureExistsDir(pkg.path);
                              await gc.cleanupOnFinish(async () => {
                                const repo = createRepo(repoConfig);
                                if (minFreeDiskSpace)
                                  await repo.ensureFreeDiskSpace(
                                    repoConfig.config,
                                    minFreeDiskSpace,
                                  );
                                await repo.backup({
                                  options: this.options,
                                  snapshot,
                                  package: pkg as any,
                                  packageConfig: pkg.repositoryConfigs?.find(
                                    (config) =>
                                      config.type === repoConfig.type &&
                                      (!config.names ||
                                        config.names.includes(repoConfig.name)),
                                  )?.config,
                                  onProgress: (progress) =>
                                    pm.update(
                                      progress,
                                      (text) => (task.output = text),
                                    ),
                                });
                              });
                            },
                          }) satisfies ListrTask,
                      ),
                      {
                        title: "Cleaning task files",
                        exitOnError: false,
                        enabled: gc.pending,
                        task: async () => await gc.cleanup(),
                      },
                      ...mirrors.map(
                        (mirror) =>
                          ({
                            title: `Copying backup into ${mirror.name}`,
                            exitOnError: false,
                            task: async () => {
                              const repoConfig = findRepositoryOrFail(
                                this.config,
                                mirror.sourceName,
                              );
                              const mirrorRepoConfig = findRepositoryOrFail(
                                this.config,
                                mirror.name,
                              );
                              await gc.cleanup(async () => {
                                const repo = createRepo(repoConfig);
                                const mirrorRepo = createRepo(mirrorRepoConfig);
                                if (minFreeDiskSpace)
                                  await mirrorRepo.ensureFreeDiskSpace(
                                    mirrorRepoConfig.config,
                                    minFreeDiskSpace,
                                  );
                                await repo.copy({
                                  options: this.options,
                                  package: pkg,
                                  snapshot,
                                  mirrorRepositoryConfig:
                                    mirrorRepoConfig.config,
                                  onProgress: (progress) =>
                                    pm.update(
                                      progress,
                                      (text) => (task.output = text),
                                    ),
                                });
                              });
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
      ],
      pm.tty
        ? {
            renderer: "default",
            collectErrors: "minimal",
            rendererOptions: {
              collapseSubtasks: false,
              collapseErrors: false,
              timer: PRESET_TIMER,
            },
          }
        : {
            renderer: "simple",
            collectErrors: "minimal",
            rendererOptions: {
              timestamp: PRESET_TIMESTAMP,
              timer: PRESET_TIMER,
            },
          },
    )
      .onBeforeRun(() => pm.start())
      .onAfterRun(() => pm.dispose());
  }
}
