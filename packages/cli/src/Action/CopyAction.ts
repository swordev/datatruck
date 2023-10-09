import type { ConfigType } from "../Config/Config";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { createRepo } from "../Factory/RepositoryFactory";
import { Listr3 } from "../utils/async";
import {
  ensureSameRepositoryType,
  filterRepository,
  findRepositoryOrFail,
} from "../utils/datatruck/config";
import { ProgressManager } from "../utils/progress";
import { ensureFreeDiskTempSpace } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import { ListrTask, PRESET_TIMER, PRESET_TIMESTAMP } from "listr2";

export type CopyActionOptionsType = {
  ids: string[];
  repositoryName: string;
  packageNames?: string[];
  packageTaskNames?: string[];
  repositoryNames2?: string[];
  verbose?: boolean;
  tty?: "auto" | boolean;
  progress?: "auto" | "interval" | boolean;
  progressInterval?: number;
};

export class CopyAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, CopyActionOptionsType>,
  ) {}

  async exec() {
    const { options } = this;
    const { minFreeDiskSpace } = this.config;
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: options.tty,
      enabled: options.progress,
      interval: options.progressInterval,
    });
    let sourceRepoConfig!: RepositoryConfigType;

    if (minFreeDiskSpace) await ensureFreeDiskTempSpace(minFreeDiskSpace);

    return new Listr3(
      [
        {
          title: "Fetching snapshot",
          task: async (_, task) => {
            sourceRepoConfig = findRepositoryOrFail(
              this.config,
              this.options.repositoryName,
            );
            const repo = createRepo(sourceRepoConfig);
            const snapshots = await repo.fetchSnapshots({
              options: {
                ids: this.options.ids,
                packageNames: this.options.packageNames,
                packageTaskNames: this.options.packageTaskNames,
              },
            });
            task.title = `Snapshots found: ${snapshots.length}`;
            if (!snapshots.length) throw new Error("No snapshots found");
            return task.newListr(
              snapshots.map((snapshot) => {
                return {
                  exitOnError: false,
                  title: `Copying snapshot ${
                    snapshot.packageName
                  } (${snapshot.id.slice(0, 8)})`,
                  task: async (_, task) => {
                    const repositoryNames2 =
                      this.options.repositoryNames2 ||
                      this.config.repositories
                        .filter(
                          (r) =>
                            r.name !== sourceRepoConfig.name &&
                            r.type === sourceRepoConfig.type &&
                            filterRepository(r, "backup"),
                        )
                        .map((r) => r.name);
                    if (!repositoryNames2.length)
                      throw new Error(`No repositories founds`);
                    return task.newListr(
                      repositoryNames2.map((repo2) => {
                        return {
                          title: `Copying to ${repo2}`,
                          exitOnError: false,
                          task: async (_, task) => {
                            const mirrorRepositoryConfig = findRepositoryOrFail(
                              this.config,
                              repo2,
                            );
                            const mirrorRepo = createRepo(
                              mirrorRepositoryConfig,
                            );
                            ensureSameRepositoryType(
                              sourceRepoConfig,
                              mirrorRepositoryConfig,
                            );
                            const currentCopies =
                              await mirrorRepo.fetchSnapshots({
                                options: {
                                  ids: [snapshot.id],

                                  packageNames: [snapshot.packageName],
                                },
                              });
                            if (currentCopies.length)
                              return task.skip(
                                `Already exists at ${mirrorRepositoryConfig.name}`,
                              );
                            if (minFreeDiskSpace)
                              await mirrorRepo.ensureFreeDiskSpace(
                                mirrorRepositoryConfig.config,
                                minFreeDiskSpace,
                              );
                            await repo.copy({
                              mirrorRepositoryConfig:
                                mirrorRepositoryConfig.config,
                              options: { verbose: this.options.verbose },
                              package: { name: snapshot.packageName },
                              snapshot,
                              onProgress: (p) =>
                                pm.update(p, (d) => (task.output = d)),
                            });
                            task.title = `Snapshot copied to ${mirrorRepositoryConfig.name}`;
                          },
                        } satisfies ListrTask;
                      }),
                    );
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
