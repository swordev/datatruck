import { Snapshot } from "../repositories/RepositoryAbstract";
import { TaskAbstract } from "../tasks/TaskAbstract";
import { renderError, renderListTaskItem, renderResult } from "../utils/cli";
import { DataFormat } from "../utils/data-format";
import {
  findPackageOrFail,
  findRepositoryOrFail,
  resolvePackage,
} from "../utils/datatruck/config";
import type { Config, PackageConfig } from "../utils/datatruck/config-type";
import { createAndInitRepo } from "../utils/datatruck/repository";
import { createTask } from "../utils/datatruck/task";
import { duration } from "../utils/date";
import { AppError } from "../utils/error";
import { ensureFreeDiskSpace, initEmptyDir } from "../utils/fs";
import { Listr3, Listr3TaskResultEnd } from "../utils/list";
import { Progress, ProgressManager, ProgressMode } from "../utils/progress";
import { StdStreams } from "../utils/stream";
import { createPatternFilter } from "../utils/string";
import { GargabeCollector, ensureFreeDiskTempSpace } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import { SnapshotsAction } from "./SnapshotsAction";
import { ok } from "assert";
import chalk from "chalk";

export type RestoreActionOptions = {
  snapshotId: string;
  tags?: string[];
  packageNames?: string[];
  packageTaskNames?: string[];
  packageConfig?: boolean;
  repositoryNames?: string[];
  repositoryTypes?: string[];
  verbose?: boolean;
  initial?: boolean;
  tty?: "auto" | boolean;
  progress?: ProgressMode;
  streams?: StdStreams;
};

type RestoreSnapshot = Snapshot & {
  repositoryName: string;
};

type Context = {
  snapshots: { id: string; packages: number };
  task: { taskName: string; packageName: string };
  restore: RestoreSnapshot;
};

export class RestoreAction<TRequired extends boolean = true> {
  protected taskErrors: Record<string, Error[]> = {};
  protected repoErrors: Record<string, Error[]> = {};

  constructor(
    readonly config: Config,
    readonly options: IfRequireKeys<TRequired, RestoreActionOptions>,
  ) {}

  protected async findSnapshots() {
    const result: RestoreSnapshot[] = [];
    const filterRepo = createPatternFilter(this.options.repositoryNames);
    const filterRepoType = createPatternFilter(this.options.repositoryTypes);

    for (const repository of this.config.repositories) {
      if (!filterRepo(repository.name)) continue;
      if (!filterRepoType(repository.type)) continue;

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
  protected async restore(data: {
    pkg: PackageConfig;
    task: TaskAbstract | undefined;
    snapshot: RestoreSnapshot;
    onProgress: (progress: Progress) => void;
  }) {
    let { snapshot, pkg, task } = data;
    const repoConfig = findRepositoryOrFail(
      this.config,
      snapshot.repositoryName,
    );
    const repo = await createAndInitRepo(repoConfig, this.options.verbose);

    let snapshotPath = pkg.restorePath ?? pkg.path;

    if (task) {
      const taskResult = await task.prepareRestore({
        options: this.options,
        package: pkg,
        snapshot,
      });
      snapshotPath = taskResult?.snapshotPath;
    }
    await initEmptyDir(snapshotPath);
    if (this.config.minFreeDiskSpace)
      await ensureFreeDiskSpace([snapshotPath!], this.config.minFreeDiskSpace);
    await repo.restore({
      options: this.options,
      snapshot: data.snapshot,
      package: pkg,
      snapshotPath: snapshotPath!,
      packageConfig: pkg.repositoryConfigs?.find(
        (config) =>
          config.type === repoConfig.type &&
          (!config.names || config.names.includes(repoConfig.name)),
      )?.config,
      onProgress: data.onProgress,
    });
    return { snapshotPath };
  }
  dataFormat(
    result: Listr3TaskResultEnd<Context>[],
    options: {
      streams?: StdStreams;
      verbose?: number;
    } = {},
  ) {
    const renderTitle = (
      item: Listr3TaskResultEnd<Context>,
      color?: boolean,
    ) => {
      let title = item.key.slice(0, 1).toUpperCase() + item.key.slice(1);
      return item.key === "restore" && color ? chalk.cyan(title) : title;
    };
    const renderData = (
      item: Listr3TaskResultEnd<Context>,
      color?: boolean,
      result: Listr3TaskResultEnd<Context>[] = [],
    ) => {
      const g = (v: string) => (color ? `${chalk.gray(`(${v})`)}` : `(${v})`);
      return renderListTaskItem(item, color, {
        snapshots: (data) => [
          data.id.slice(0, 8),
          g(`${data.packages} packages`),
        ],
        task: (data) => [data.packageName, g(data.taskName)],
        restore: (data) => [data.packageName, g(data.repositoryName)],
        summary: (data) => ({
          errors: data.errors,
          restores: result.filter((r) => !r.error && r.key === "restore")
            .length,
        }),
      });
    };
    return new DataFormat({
      streams: options.streams,
      json: result,
      table: {
        headers: [
          { value: "", width: 3 },
          { value: "Title", width: 15 },
          { value: "Data" },
          { value: "Duration", width: 10 },
          { value: "Error", width: 50 },
        ],
        rows: () =>
          result.map((item) => [
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
    const gc = new GargabeCollector();
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: options.tty,
      mode: options.progress,
    });

    const l = new Listr3<Context>({
      streams: options.streams,
      progressManager: pm,
      gargabeCollector: gc,
    });

    return l
      .add(
        l.$task({
          key: "snapshots",
          data: {
            id: "",
            packages: 0,
          },
          title: {
            initial: "Fetch snapshots",
            started: "Fetching snapshots",
            completed: "Snapshots fetched",
            failed: "Snapshot fetch failed",
          },
          run: async (_, data) => {
            const { minFreeDiskSpace } = this.config;
            if (minFreeDiskSpace)
              await ensureFreeDiskTempSpace(minFreeDiskSpace);
            if (!options.snapshotId)
              throw new AppError("Snapshot id is required");
            const snapshots = this.groupSnapshots(await this.findSnapshots());
            if (!snapshots.length) throw new AppError("None snapshot found");

            data.id = options.snapshotId;
            data.packages = snapshots.length;

            return snapshots.map((snapshot) =>
              l.$task({
                key: "restore",
                keyIndex: snapshot.packageName,
                data: snapshot,
                title: {
                  initial: `Restore snapshot: ${snapshot.packageName} (${snapshot.repositoryName})`,
                  started: `Restoring snapshot: ${snapshot.packageName} (${snapshot.repositoryName})`,
                  completed: `Snapshot restored: ${snapshot.packageName} (${snapshot.repositoryName})`,
                  failed: `Snapshot restore failed: ${snapshot.packageName} (${snapshot.repositoryName})`,
                },
                exitOnError: false,
                run: async (listTask) => {
                  let pkg = resolvePackage(
                    findPackageOrFail(this.config, snapshot.packageName),
                    {
                      snapshotId: options.snapshotId,
                      snapshotDate: snapshot.date,
                      action: "restore",
                    },
                  );

                  if (this.options.initial)
                    pkg = { ...pkg, restorePath: pkg.path };

                  const task = pkg.task ? createTask(pkg.task) : undefined;
                  using progress = pm.create(listTask);
                  const restoreGc = gc.create();
                  const restore = await restoreGc.disposeIfFail(() =>
                    this.restore({
                      pkg,
                      task,
                      snapshot: snapshot,
                      onProgress: progress.update,
                    }),
                  );
                  if (!task) return await restoreGc.dispose();
                  return l.$tasks({
                    key: "task",
                    keyIndex: pkg.name,
                    data: { taskName: pkg.task!.name, packageName: pkg.name },
                    title: {
                      initial: `Execute task: ${pkg.name} (${pkg.task!.name})`,
                      started: `Executing task: ${pkg.name} (${
                        pkg.task!.name
                      })`,
                      completed: `Task executed: ${pkg.name} (${
                        pkg.task!.name
                      })`,
                      failed: `Task execute failed: ${pkg.name} (${
                        pkg.task!.name
                      })`,
                    },
                    exitOnError: false,
                    run: async (listTask) => {
                      await using _ = restoreGc.disposeOnFinish();
                      const { snapshotPath } = restore;
                      ok(snapshotPath);
                      using progress = pm.create(listTask);
                      await task!.restore({
                        package: pkg,
                        options,
                        snapshot,
                        snapshotPath,
                        onProgress: progress.update,
                      });
                    },
                  });
                },
              }),
            );
          },
        }),
      )
      .exec();
  }
}
