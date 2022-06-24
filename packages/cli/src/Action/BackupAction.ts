import type { ConfigType } from "../Config/Config";
import { PackageConfigType } from "../Config/PackageConfig";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { TaskConfigType } from "../Config/TaskConfig";
import { AppError } from "../Error/AppError";
import { RepositoryFactory } from "../Factory/RepositoryFactory";
import { TaskFactory } from "../Factory/TaskFactory";
import { SnapshotType } from "../Repository/RepositoryAbstract";
import { BackupSessionManager } from "../SessionManager/BackupSessionManager";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../util/datatruck/config-util";
import { IfRequireKeys } from "../util/ts-util";
import { randomBytes } from "crypto";

export type BackupActionOptionsType = {
  repositoryNames?: string[];
  repositoryTypes?: string[];
  packageNames?: string[];
  packageTaskNames?: string[];
  tags?: string[];
  dryRun?: boolean;
  verbose?: boolean;
  date?: string;
};

export class BackupAction<TRequired extends boolean = true> {
  protected taskErrors: Record<string, Error[]> = {};
  protected repoErrors: Record<string, Error[]> = {};
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<
      TRequired,
      BackupActionOptionsType
    > = {} as any
  ) {}

  protected async init(session: BackupSessionManager) {
    const snapshot = {
      id: randomBytes(20).toString("hex"),
      date: this.options.date ?? new Date().toISOString(),
    } as SnapshotType;

    await session.initDrivers();

    let packages = filterPackages(this.config, {
      packageNames: this.options.packageNames,
      packageTaskNames: this.options.packageTaskNames,
      repositoryNames: this.options.repositoryNames,
      repositoryTypes: this.options.repositoryTypes,
      sourceAction: "backup",
    });

    packages = resolvePackages(packages, {
      snapshotId: snapshot.id,
      snapshotDate: snapshot.date,
      action: "backup",
    });

    for (const pkg of packages) {
      const sessionId = await session.init({
        snapshotId: snapshot.id,
        packageName: pkg.name,
        tags: this.options.tags?.join(",") ?? "",
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

    return [snapshot, packages] as [SnapshotType, PackageConfigType[]];
  }

  protected async execTask(
    session: BackupSessionManager,
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

    const key = `${pkg.name}`;
    let error: Error | undefined;

    if (this.taskErrors[key]?.length) {
      error = new AppError("Previous task failed");
    } else {
      try {
        const taskInstance = TaskFactory(task);
        await taskInstance.onBackup({
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
        if (!this.taskErrors[key]) this.taskErrors[key] = [];
        this.taskErrors[key].push((error = _ as Error));
      }
    }

    await session.endTask({
      id: taskId,
      error: error?.stack,
    });

    return error ? false : true;
  }

  protected async execRepository(
    session: BackupSessionManager,
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

    let error: Error | undefined;
    if (this.taskErrors[pkg.name]?.length) {
      error = new AppError("Task failed");
    } else {
      try {
        const repoInstance = RepositoryFactory(repo);
        await repoInstance.onBackup({
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
      } catch (_) {
        if (!this.repoErrors[pkg.name]) this.repoErrors[pkg.name] = [];
        this.repoErrors[pkg.name].push((error = _ as Error));
      }
    }
    await session.endRepository({
      id: repositoryId,
      error: error?.stack,
    });
    return error ? false : true;
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

  async exec(session: BackupSessionManager) {
    const [snapshot, packages] = await this.init(session);
    let total = 0;
    let errors = 0;
    for (const pkg of packages) {
      total++;
      const id = session.findId({
        packageName: pkg.name,
      });

      await session.start({
        id,
      });

      let targetPath: string | undefined;

      if (pkg.task) {
        const taskInstance = TaskFactory(pkg.task);
        const result = await taskInstance.onBeforeBackup({
          options: this.options,
          package: pkg,
          snapshot,
        });
        await this.execTask(
          session,
          pkg,
          pkg.task,
          snapshot,
          (targetPath = result?.targetPath)
        );
      }

      for (const repoName of pkg.repositoryNames ?? []) {
        const repo = findRepositoryOrFail(this.config, repoName);
        await this.execRepository(session, pkg, repo, snapshot, targetPath);
      }

      const error = this.getError(pkg);

      if (error) errors++;
      await session.end({
        id: id,
        error: error?.message,
      });
    }

    await session.endDrivers({
      snapshotId: snapshot.id.slice(0, 8),
    });

    return {
      total: total,
      errors: errors,
    };
  }
}
