import type { ConfigType } from "../Config/Config";
import { PackageConfigType } from "../Config/PackageConfig";
import { AppError } from "../Error/AppError";
import { createRepo } from "../Factory/RepositoryFactory";
import { createTask } from "../Factory/TaskFactory";
import { Snapshot } from "../Repository/RepositoryAbstract";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../utils/datatruck/config";
import { ensureFreeDiskSpace, initEmptyDir } from "../utils/fs";
import { Listr3 } from "../utils/list";
import { ProgressManager } from "../utils/progress";
import { GargabeCollector, ensureFreeDiskTempSpace } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import { SnapshotsAction } from "./SnapshotsAction";
import { ok } from "assert";
import { ListrTask } from "listr2";

export type RestoreActionOptions = {
  snapshotId: string;
  tags?: string[];
  packageNames?: string[];
  packageTaskNames?: string[];
  packageConfig?: boolean;
  repositoryNames?: string[];
  repositoryTypes?: string[];
  verbose?: boolean;
  restorePath?: boolean;
  tty?: "auto" | boolean;
  progress?: "auto" | "interval" | boolean;
  progressInterval?: number;
};

type RestoreSnapshot = Snapshot & {
  repositoryName: string;
};

export class RestoreAction<TRequired extends boolean = true> {
  protected taskErrors: Record<string, Error[]> = {};
  protected repoErrors: Record<string, Error[]> = {};

  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, RestoreActionOptions>,
  ) {}

  protected assocConfigs(
    packages: PackageConfigType[],
    snapshots: RestoreSnapshot[],
  ): [RestoreSnapshot, PackageConfigType][] {
    return snapshots.map((snapshot) => {
      const pkg =
        packages.find((pkg) => pkg.name === snapshot.packageName) ?? null;
      if (!pkg)
        throw new Error(`Package config not found: ${snapshot.packageName}`);
      return [snapshot, pkg];
    });
  }

  protected async findSnapshots() {
    const result: RestoreSnapshot[] = [];

    for (const repository of this.config.repositories) {
      if (
        this.options.repositoryNames &&
        !this.options.repositoryNames.includes(repository.name)
      )
        continue;

      if (
        this.options.repositoryTypes &&
        !this.options.repositoryTypes.includes(repository.type)
      )
        continue;

      const snapshotsAction = new SnapshotsAction<false>(this.config, {
        repositoryNames: [repository.name],
        ids: [this.options.snapshotId],
        packageNames: this.options.packageNames,
        packageTaskNames: this.options.packageTaskNames,
        packageConfig: this.options.packageConfig,
        tags: this.options.tags,
      });
      const snapshots = await snapshotsAction.exec("restore");

      result.push(
        ...snapshots.map(
          (ss) =>
            ({
              date: ss.date,
              id: ss.id,
              originalId: ss.originalId,
              packageName: ss.packageName,
              packageTaskName: ss.packageTaskName,
              tags: ss.tags,
              repositoryName: repository.name,
            }) as RestoreSnapshot,
        ),
      );
    }

    return result;
  }

  protected groupSnapshots(snapshots: RestoreSnapshot[]) {
    const names: string[] = [];
    return snapshots.filter((snapshot) => {
      if (names.includes(snapshot.packageName)) return false;
      names.push(snapshot.packageName);
      return true;
    });
  }

  protected getPackages(snapshot: { date: string }) {
    const packages = filterPackages(this.config, {
      ...this.options,
      sourceAction: "restore",
    });
    return resolvePackages(packages, {
      snapshotId: this.options.snapshotId,
      snapshotDate: snapshot.date,
      action: "restore",
    });
  }

  async exec() {
    const { options } = this;
    const { minFreeDiskSpace } = this.config;
    const pm = new ProgressManager({
      verbose: this.options.verbose,
      tty: options.tty,
      enabled: options.progress,
      interval: options.progressInterval,
    });

    if (minFreeDiskSpace) await ensureFreeDiskTempSpace(minFreeDiskSpace);

    if (!options.snapshotId) throw new AppError("Snapshot id is required");
    const snapshots = this.groupSnapshots(await this.findSnapshots());
    const [snapshot] = snapshots;
    if (!snapshot) throw new AppError("None snapshot found");
    const packages = this.getPackages(snapshot);
    const snapshotAndConfigs = this.assocConfigs(packages, snapshots);

    return new Listr3({ tty: () => pm.tty })
      .onBeforeRun(() => pm.start())
      .onAfterRun(() => pm.dispose())
      .add([
        {
          title: `Snapshot: ${snapshot.id.slice(0, 8)}`,
          task: () => {},
        },
        ...snapshotAndConfigs.map(([snapshot, pkg]) => {
          return {
            title: `Restoring ${pkg.name}`,
            exitOnError: false,
            task: async (_, listTask) => {
              const repoConfig = findRepositoryOrFail(
                this.config,
                snapshot.repositoryName,
              );
              const gc = new GargabeCollector();
              const repo = createRepo(repoConfig);
              const task = pkg.task ? createTask(pkg.task) : undefined;

              if (!options.restorePath) pkg = { ...pkg, restorePath: pkg.path };

              let snapshotPath = pkg.restorePath ?? pkg.path;

              await gc.cleanupIfFail(async () => {
                if (task) {
                  const taskResult = await task!.prepareRestore({
                    options,
                    package: pkg,
                    snapshot,
                  });
                  snapshotPath = taskResult?.snapshotPath;
                }
                await initEmptyDir(snapshotPath);
                if (minFreeDiskSpace)
                  await ensureFreeDiskSpace([snapshotPath!], minFreeDiskSpace);
                await repo.restore({
                  options,
                  snapshot,
                  package: pkg,
                  snapshotPath: snapshotPath!,
                  packageConfig: pkg.repositoryConfigs?.find(
                    (config) =>
                      config.type === repoConfig.type &&
                      (!config.names || config.names.includes(repoConfig.name)),
                  )?.config,
                  onProgress: (p) => pm.update(p, (t) => (listTask.output = t)),
                });
              });

              if (!task) await gc.cleanup();

              return listTask.newListr([
                {
                  title: `Executing task ${pkg.task?.name}`,
                  enabled: !!task,
                  task: async (_, listTask) => {
                    await gc.cleanup(async () => {
                      ok(snapshotPath);
                      await task!.restore({
                        package: pkg,
                        options,
                        snapshot,
                        snapshotPath,
                        onProgress: (p) =>
                          pm.update(p, (t) => (listTask.output = t)),
                      });
                    });
                  },
                },
              ]);
            },
          } satisfies ListrTask;
        }),
      ]);
  }
}
