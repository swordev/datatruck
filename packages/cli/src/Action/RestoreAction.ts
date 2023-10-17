import type { ConfigType } from "../Config/Config";
import { PackageConfigType } from "../Config/PackageConfig";
import { createRepo } from "../Factory/RepositoryFactory";
import { createTask } from "../Factory/TaskFactory";
import { Snapshot } from "../Repository/RepositoryAbstract";
import { TaskAbstract } from "../Task/TaskAbstract";
import { DataFormat } from "../utils/DataFormat";
import { errorColumn, resultColumn } from "../utils/cli";
import {
  findPackageOrFail,
  findRepositoryOrFail,
  resolvePackage,
} from "../utils/datatruck/config";
import { duration } from "../utils/date";
import { ensureFreeDiskSpace, initEmptyDir } from "../utils/fs";
import { Listr3, Listr3TaskResultEnd } from "../utils/list";
import { Progress, ProgressManager } from "../utils/progress";
import { Streams } from "../utils/stream";
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
  progress?: "auto" | "interval" | boolean;
  progressInterval?: number;
  streams?: Streams;
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
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, RestoreActionOptions>,
  ) {}

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
  protected async restore(data: {
    pkg: PackageConfigType;
    task: TaskAbstract | undefined;
    snapshot: RestoreSnapshot;
    gc: GargabeCollector;
    onProgress: (progress: Progress) => void;
  }) {
    let { snapshot, pkg, task } = data;
    const repoConfig = findRepositoryOrFail(
      this.config,
      snapshot.repositoryName,
    );
    const repo = createRepo(repoConfig);

    if (this.options.initial) pkg = { ...pkg, restorePath: pkg.path };

    let snapshotPath = pkg.restorePath ?? pkg.path;

    await data.gc.cleanupIfFail(async () => {
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
        await ensureFreeDiskSpace(
          [snapshotPath!],
          this.config.minFreeDiskSpace,
        );
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
    });
    return { snapshotPath };
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
      return item.key === "restore" && color ? chalk.cyan(title) : title;
    };
    const renderData = (
      item: Listr3TaskResultEnd<Context>,
      color?: boolean,
    ) => {
      const g = (v: string) => (color ? `${chalk.gray(`(${v})`)}` : `(${v})`);
      return item.key === "snapshots"
        ? `${item.data.id.slice(0, 8)} ${g(`${item.data.packages} packages`)}`
        : item.key === "task"
        ? `${item.data.packageName} ${g(item.data.taskName)}`
        : item.key === "restore"
        ? `${item.data.packageName} ${g(item.data.repositoryName)}`
        : "";
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
            resultColumn(item.error),
            renderTitle(item, true),
            renderData(item, true),
            duration(item.elapsed),
            errorColumn(item.error, options.verbose),
          ]),
      },
    });
  }
  async exec() {
    const { options } = this;
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: options.tty,
      enabled: options.progress,
      interval: options.progressInterval,
    });

    const l = new Listr3<Context>({
      streams: options.streams,
      progressManager: pm,
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
            if (!options.snapshotId) throw new Error("Snapshot id is required");
            const snapshots = this.groupSnapshots(await this.findSnapshots());
            if (!snapshots.length) throw new Error("None snapshot found");

            data.id = options.snapshotId;
            data.packages = snapshots.length;

            return snapshots.map((snapshot) =>
              l.$task({
                key: "restore",
                keyIndex: snapshot.packageName,
                data: snapshot,
                title: {
                  initial: `Restore ${snapshot.packageName} snapshot`,
                  started: `Restoring ${snapshot.packageName} snapshot`,
                  completed: `Snapshot restored: ${snapshot.packageName}`,
                  failed: `Snapshot restore failed: ${snapshot.packageName}`,
                },
                exitOnError: false,
                run: async (listTask) => {
                  const pkg = resolvePackage(
                    findPackageOrFail(this.config, snapshot.packageName),
                    {
                      snapshotId: options.snapshotId,
                      snapshotDate: snapshot.date,
                      action: "restore",
                    },
                  );
                  const gc = new GargabeCollector();
                  const task = pkg.task ? createTask(pkg.task) : undefined;
                  const restore = await this.restore({
                    gc,
                    pkg,
                    task,
                    snapshot: snapshot,
                    onProgress: (p) =>
                      pm.update(p, (t) => (listTask.output = t)),
                  });
                  if (!task) return await gc.cleanup();
                  return l.$tasks({
                    key: "task",
                    keyIndex: pkg.name,
                    data: { taskName: pkg.task!.name, packageName: pkg.name },
                    title: {
                      initial: `Execute ${pkg.task?.name} task`,
                      started: `Executing ${pkg.task?.name} task`,
                      completed: `Task executed: ${pkg.task?.name}`,
                      failed: `Task execute failed: ${pkg.task?.name}`,
                    },
                    exitOnError: false,
                    runWrapper: gc.cleanup.bind(gc),
                    run: async (listTask) => {
                      const { snapshotPath } = restore;
                      ok(snapshotPath);
                      await task!.restore({
                        package: pkg,
                        options,
                        snapshot,
                        snapshotPath,
                        onProgress: (p) =>
                          pm.update(p, (t) => (listTask.output = t)),
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
