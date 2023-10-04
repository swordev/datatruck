import type { ConfigType } from "../Config/Config";
import { PackageConfigType } from "../Config/PackageConfig";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { TaskConfigType } from "../Config/TaskConfig";
import { AppError } from "../Error/AppError";
import { RepositoryFactory } from "../Factory/RepositoryFactory";
import { TaskFactory } from "../Factory/TaskFactory";
import {
  RepositoryAbstract,
  SnapshotResultType,
} from "../Repository/RepositoryAbstract";
import { RestoreSessionManager } from "../SessionManager/RestoreSessionManager";
import { TaskAbstract } from "../Task/TaskAbstract";
import { logExec } from "../utils/cli";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../utils/datatruck/config";
import { isEmptyDir, isTmpDir, mkdirIfNotExists, rmTmpDir } from "../utils/fs";
import { push } from "../utils/object";
import { exec } from "../utils/process";
import { IfRequireKeys } from "../utils/ts";
import { SnapshotsAction } from "./SnapshotsAction";
import { ok } from "assert";
import { platform } from "os";

export type RestoreActionOptionsType = {
  snapshotId: string;
  tags?: string[];
  packageNames?: string[];
  packageTaskNames?: string[];
  packageConfig?: boolean;
  repositoryNames?: string[];
  repositoryTypes?: string[];
  verbose?: boolean;
  restorePath?: boolean;
};

type SnapshotType = SnapshotResultType & {
  repositoryName: string;
};

type SnapshotAndConfigType = [SnapshotType, PackageConfigType | null];

export class RestoreAction<TRequired extends boolean = true> {
  protected taskErrors: Record<string, Error[]> = {};
  protected repoErrors: Record<string, Error[]> = {};

  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, RestoreActionOptionsType>,
  ) {}

  protected assocConfigs(
    packages: PackageConfigType[],
    snapshots: SnapshotType[],
  ): [SnapshotType, PackageConfigType | null][] {
    return snapshots.map((snapshot) => {
      const pkg =
        packages.find((pkg) => pkg.name === snapshot.packageName) ?? null;
      return [snapshot, pkg];
    });
  }

  protected async init(
    session: RestoreSessionManager,
    snapshotId: string,
    snapshots: SnapshotAndConfigType[],
  ) {
    await session.initDrivers();

    for (const [snapshot, pkg] of snapshots) {
      if (!pkg)
        throw new AppError(`Package config not found: ${snapshot.packageName}`);

      const sessionId = await session.init({
        snapshotId: snapshotId,
        packageName: pkg.name,
      });

      if (pkg.task)
        await session.initTask({
          sessionId: sessionId,
          taskName: pkg.task.name,
        });

      for (const repositoryName of pkg.repositoryNames ?? []) {
        const repo = findRepositoryOrFail(this.config, repositoryName);
        await session.initRepository({
          sessionId: sessionId,
          repositoryName: repositoryName,
          repositoryType: repo.type,
        });
      }
    }
  }

  protected async findSnapshots() {
    const result: SnapshotType[] = [];

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
            }) as SnapshotType,
        ),
      );
    }

    return result;
  }

  protected groupSnapshots(snapshots: SnapshotType[]) {
    const names: string[] = [];
    return snapshots.filter((snapshot) => {
      if (names.includes(snapshot.packageName)) return false;
      names.push(snapshot.packageName);
      return true;
    });
  }

  protected async task(
    session: RestoreSessionManager,
    pkg: PackageConfigType,
    task: TaskAbstract<any>,
    snapshot: SnapshotType,
    targetPath: string | undefined,
  ) {
    const taskId = session.findTaskId({
      packageName: pkg.name,
      taskName: pkg.task!.name,
    });

    await session.startTask({
      id: taskId,
    });

    let error: Error | undefined;

    if (this.repoErrors[pkg.name]?.length) {
      error = AppError.create("Repository failed", this.repoErrors[pkg.name]);
    } else if (this.taskErrors[pkg.name]?.length) {
      error = AppError.create(
        "Previous task failed",
        this.taskErrors[pkg.name],
      );
    } else {
      try {
        await task.onRestore({
          package: pkg,
          options: this.options,
          snapshot,
          targetPath,
          onProgress: async (progress) => {
            await session.progressTask({
              id: taskId,
              progress,
            });
          },
        });
      } catch (_) {
        if (!this.taskErrors[pkg.name]) this.taskErrors[pkg.name] = [];
        this.taskErrors[pkg.name].push((error = _ as Error));
      }
    }

    await session.endTask({
      id: taskId,
      error: error?.stack,
    });

    return {
      error: error ? false : true,
      tmpDirs: task?.tmpDirs ?? [],
    };
  }

  protected async restore(
    session: RestoreSessionManager,
    pkg: PackageConfigType,
    repo: RepositoryConfigType,
    snapshot: SnapshotType,
    targetPath: string | undefined,
  ) {
    const repositoryId = session.findRepositoryId({
      packageName: pkg.name,
      repositoryName: repo.name,
    });

    await session.startRepository({
      id: repositoryId,
    });

    let repoError: Error | undefined;
    let repoInstance: RepositoryAbstract<any> | undefined;

    if (!this.options.restorePath)
      pkg = {
        ...pkg,
        restorePath: pkg.path,
      };

    try {
      if (typeof pkg.restorePath !== "string")
        throw new AppError("Restore path is not defined");

      await mkdirIfNotExists(pkg.restorePath);

      if (!(await isEmptyDir(pkg.restorePath)))
        throw new AppError(`Restore path is not empty: ${pkg.restorePath}`);

      if (this.options.verbose) logExec(`restorePath=${pkg.restorePath}`);

      repoInstance = RepositoryFactory(repo);
      await repoInstance.onRestore({
        package: pkg,
        targetPath,
        packageConfig: pkg.repositoryConfigs?.find(
          (config) =>
            config.type === repo.type &&
            (!config.names || config.names.includes(repo.name)),
        )?.config,
        options: this.options,
        snapshot: snapshot,
        onProgress: async (progress) => {
          await session.progressRepository({
            id: repositoryId,
            progress,
          });
        },
      });
      if (pkg.restorePermissions && platform() !== "win32")
        await exec(
          "chown",
          [
            "-R",
            `${pkg.restorePermissions.uid}:${pkg.restorePermissions.gid}`,
            pkg.restorePath,
          ],
          {},
          {
            log: this.options.verbose,
          },
        );
    } catch (error) {
      push(this.repoErrors, pkg.name, (repoError = error as Error));
    }
    await session.endRepository({
      id: repositoryId,
      error: repoError?.stack,
    });
    return {
      error: repoError ? false : true,
      tmpDirs: repoInstance?.tmpDirs || [],
    };
  }

  protected getError(pkg: PackageConfigType) {
    const taskErrors = this.taskErrors[pkg.name] || [];
    const repoErrors = this.repoErrors[pkg.name] || [];
    const errors = [...taskErrors, ...repoErrors];
    if (!errors.length) return;
    return AppError.create(
      taskErrors.length && repoErrors.length
        ? "Task and repository failed"
        : taskErrors.length && !repoErrors.length
        ? "Task failed"
        : "Repository failed",
      errors,
    );
  }

  async exec(session: RestoreSessionManager) {
    if (!this.options.snapshotId) throw new AppError("Snapshot id is required");
    const snapshots = this.groupSnapshots(await this.findSnapshots());

    if (!snapshots.length) throw new AppError("None snapshot found");

    let packages = filterPackages(this.config, {
      ...this.options,
      sourceAction: "restore",
    });

    packages = resolvePackages(packages, {
      snapshotId: this.options.snapshotId,
      snapshotDate: snapshots[0].date,
      action: "restore",
    });

    const snapshotAndConfigs = this.assocConfigs(packages, snapshots);

    await this.init(session, this.options.snapshotId, snapshotAndConfigs);

    const errors: Error[] = [];

    for (const [snapshot, pkg] of snapshotAndConfigs) {
      ok(pkg);

      const repo = findRepositoryOrFail(this.config, snapshot.repositoryName);

      const id = session.findId({
        packageName: pkg.name,
      });

      await session.start({ id });
      let targetPath: string | undefined;
      let taskInstance: TaskAbstract<any> | undefined;
      if (pkg.task) {
        taskInstance = TaskFactory(pkg.task);
        const result = await taskInstance.onBeforeRestore({
          options: this.options,
          package: pkg,
          snapshot,
        });
        targetPath = result?.targetPath;
      }

      const { tmpDirs } = await this.restore(
        session,
        pkg,
        repo,
        snapshot,
        targetPath,
      );

      if (taskInstance) {
        await this.task(session, pkg, taskInstance, snapshot, targetPath);
      }

      if (!this.options.verbose) {
        await rmTmpDir(taskInstance?.tmpDirs || []);
        await rmTmpDir(tmpDirs);
        if (pkg.restorePath && isTmpDir(pkg.restorePath))
          await rmTmpDir(pkg.restorePath);
      }

      const error = this.getError(pkg);
      await session.end({
        id,
        error: error?.message,
      });
      if (error) errors.push(error);
    }
    await session.endDrivers();
    return { errors };
  }
}
