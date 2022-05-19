import type { ConfigType } from "../Config/Config";
import { PackageConfigType } from "../Config/PackageConfig";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { TaskConfigType } from "../Config/TaskConfig";
import { AppError } from "../Error/AppError";
import { RepositoryFactory } from "../Factory/RepositoryFactory";
import { TaskFactory } from "../Factory/TaskFactory";
import { SnapshotResultType } from "../Repository/RepositoryAbstract";
import { RestoreSessionManager } from "../SessionManager/RestoreSessionManager";
import { logExec } from "../util/cli-util";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../util/datatruck/config-util";
import { isDirEmpty, mkdirIfNotExists } from "../util/fs-util";
import { push } from "../util/object-util";
import { exec } from "../util/process-util";
import { IfRequireKeys } from "../util/ts-util";
import { ok } from "assert";
import { platform } from "os";

export type RestoreActionOptionsType = {
  snapshotId: string;
  tags?: string[];
  packageNames?: string[];
  repositoryNames?: string[];
  repositoryTypes?: string[];
  verbose?: boolean;
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
    readonly options: IfRequireKeys<TRequired, RestoreActionOptionsType>
  ) {}

  protected assocConfigs(
    packages: PackageConfigType[],
    snapshots: SnapshotType[]
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
    snapshots: SnapshotAndConfigType[]
  ) {
    await session.initDrivers();

    for (const [, pkg] of snapshots) {
      ok(pkg);
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

      const repoInstance = RepositoryFactory(repository);
      const snapshots = await repoInstance.onSnapshots({
        options: {
          packageNames: this.options.packageNames,
          ids: [this.options.snapshotId],
          tags: this.options.tags,
        },
      });
      result.push(
        ...snapshots.map((snapshot) => ({
          ...snapshot,
          repositoryName: repository.name,
        }))
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

  protected async execTask(
    session: RestoreSessionManager,
    pkg: PackageConfigType,
    task: TaskConfigType,
    snapshot: SnapshotType,
    targetPath: string | undefined
  ) {
    const taskId = session.findTaskId({
      packageName: pkg.name,
      taskName: task.name,
    });

    await session.startTask({
      id: taskId,
    });

    let error: Error | undefined;

    if (this.repoErrors[pkg.name]?.length) {
      error = new AppError("Repository failed");
    } else if (this.taskErrors[pkg.name]?.length) {
      error = new AppError("Previous task failed");
    } else {
      try {
        const taskInstance = TaskFactory(task);
        await taskInstance.onRestore({
          package: pkg,
          options: this.options,
          snapshot,
          targetPath,
          onProgress: async (data) => {
            await session.progressTask({
              id: taskId,
              progressCurrent: data.current,
              progressPercent: data.percent,
              progressStep: data.step,
              progressStepPercent: data.stepPercent,
              progressTotal: data.total,
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

    return error ? false : true;
  }

  protected async execRepository(
    session: RestoreSessionManager,
    pkg: PackageConfigType,
    repo: RepositoryConfigType,
    snapshot: SnapshotType,
    targetPath: string | undefined
  ) {
    const repositoryId = session.findRepositoryId({
      packageName: pkg.name,
      repositoryName: repo.name,
    });

    await session.startRepository({
      id: repositoryId,
    });

    let repoError: Error | undefined;
    try {
      if (typeof pkg.restorePath !== "string")
        throw new AppError("Restore path is not defined");

      await mkdirIfNotExists(pkg.restorePath);

      if (!(await isDirEmpty(pkg.restorePath)))
        throw new AppError(`Restore path is not empty: ${pkg.restorePath}`);

      if (this.options.verbose) logExec(`restorePath=${pkg.restorePath}`);

      const repoInstance = RepositoryFactory(repo);
      await repoInstance.onRestore({
        package: pkg,
        targetPath,
        packageConfig: pkg.repositoryConfigs?.find(
          (config) =>
            config.type === repo.type &&
            (!config.names || config.names.includes(repo.name))
        )?.config,
        options: this.options,
        snapshot: snapshot,
        onProgress: async (data) => {
          await session.progressRepository({
            id: repositoryId,
            progressCurrent: data.current,
            progressPercent: data.percent,
            progressStep: data.step,
            progressStepPercent: data.stepPercent,
            progressTotal: data.total,
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
          }
        );
    } catch (error) {
      push(this.repoErrors, pkg.name, (repoError = error as Error));
    }
    await session.endRepository({
      id: repositoryId,
      error: repoError?.stack,
    });
    return repoError ? false : true;
  }

  protected getError(pkg: PackageConfigType) {
    const taskErrors = this.taskErrors[pkg.name]?.length;
    const repoErrors = this.repoErrors[pkg.name]?.length;

    if (taskErrors && repoErrors) {
      return new AppError("Task and repository failed");
    } else if (taskErrors && !repoErrors) {
      return new AppError("Task failed");
    } else if (!taskErrors && repoErrors) {
      return new AppError("Repository failed");
    } else {
      return null;
    }
  }

  async exec(session: RestoreSessionManager) {
    if (!this.options.snapshotId) throw new AppError("Snapshot id is required");
    const snapshots = this.groupSnapshots(await this.findSnapshots());

    if (!snapshots.length) throw new AppError("None snapshot found");

    let packages = filterPackages(this.config, this.options);

    packages = resolvePackages(packages, {
      snapshotId: this.options.snapshotId,
      snapshotDate: snapshots[0].date,
      action: "restore",
    });

    const snapshotAndConfigs = this.assocConfigs(packages, snapshots);

    await this.init(session, this.options.snapshotId, snapshotAndConfigs);

    let sessionErrors = 0;

    for (const [snapshot, pkg] of snapshotAndConfigs) {
      ok(pkg);

      const repo = findRepositoryOrFail(this.config, snapshot.repositoryName);

      const id = session.findId({
        packageName: pkg.name,
      });

      await session.start({ id });
      let targetPath: string | undefined;

      if (pkg.task) {
        const taskInstance = TaskFactory(pkg.task);
        const result = await taskInstance.onBeforeRestore({
          options: this.options,
          package: pkg,
          snapshot,
        });
        targetPath = result?.targetPath;
      }

      await this.execRepository(session, pkg, repo, snapshot, targetPath);

      if (pkg.task)
        await this.execTask(session, pkg, pkg.task, snapshot, targetPath);

      const error = this.getError(pkg);
      await session.end({
        id,
        error: error?.message,
      });
      if (error) sessionErrors++;
    }

    await session.endDrivers();
    return !sessionErrors;
  }
}
