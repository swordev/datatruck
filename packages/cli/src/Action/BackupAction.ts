import type { ConfigType } from "../Config/Config";
import { PackageConfigType } from "../Config/PackageConfig";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { AppError } from "../Error/AppError";
import { RepositoryFactory } from "../Factory/RepositoryFactory";
import { TaskFactory } from "../Factory/TaskFactory";
import {
  RepositoryAbstract,
  SnapshotType,
} from "../Repository/RepositoryAbstract";
import { BackupSessionManager } from "../SessionManager/BackupSessionManager";
import { TaskAbstract } from "../Task/TaskAbstract";
import {
  filterPackages,
  findRepositoryOrFail,
  resolvePackages,
} from "../utils/datatruck/config";
import { isTmpDir, rmTmpDir } from "../utils/fs";
import { IfRequireKeys } from "../utils/ts";
import { randomUUID } from "crypto";

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
    > = {} as any,
  ) {}

  protected async init(session: BackupSessionManager) {
    const snapshot = {
      id: randomUUID().replaceAll("-", ""),
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

  protected async task(
    session: BackupSessionManager,
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

    const key = `${pkg.name}`;
    let error: Error | undefined;

    if (this.taskErrors[key]?.length) {
      error = AppError.create("Previous task failed", this.taskErrors[key]);
    } else {
      try {
        await task.onBackup({
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
        if (!this.taskErrors[key]) this.taskErrors[key] = [];
        this.taskErrors[key].push((error = _ as Error));
      }
    }

    await session.endTask({
      id: taskId,
      error: error?.stack,
    });

    return {
      error: error ? false : true,
      tmpDirs: task.tmpDirs,
    };
  }

  protected async backup(
    session: BackupSessionManager,
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

    let error: Error | undefined;
    let repoInstance: RepositoryAbstract<any> | undefined;

    if (this.taskErrors[pkg.name]?.length) {
      error = AppError.create("Task failed", this.taskErrors[pkg.name]);
    } else {
      try {
        repoInstance = RepositoryFactory(repo);
        await repoInstance.onBackup({
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
      } catch (_) {
        if (!this.repoErrors[pkg.name]) this.repoErrors[pkg.name] = [];
        this.repoErrors[pkg.name].push((error = _ as Error));
      }
    }
    await session.endRepository({
      id: repositoryId,
      error: error?.stack,
    });
    return {
      error: error ? false : true,
      tmpDirs: repoInstance?.tmpDirs ?? [],
    };
  }

  protected async copyBackup(
    session: BackupSessionManager,
    pkg: PackageConfigType,
    repo: RepositoryConfigType,
    mirrorRepo: RepositoryConfigType,
    snapshot: SnapshotType,
  ) {
    const repositoryId = session.findRepositoryId({
      packageName: pkg.name,
      repositoryName: mirrorRepo.name,
    });

    await session.startRepository({
      id: repositoryId,
    });

    let error: Error | undefined;
    let repoInstance: RepositoryAbstract<any> | undefined;

    if (this.taskErrors[pkg.name]?.length) {
      error = AppError.create("Task failed", this.taskErrors[pkg.name]);
    } else {
      try {
        repoInstance = RepositoryFactory(repo);
        await repoInstance.onCopyBackup({
          options: this.options,
          package: pkg,
          snapshot,
          mirrorRepositoryConfig: mirrorRepo.config,
          onProgress: async (progress) => {
            await session.progressRepository({
              id: repositoryId,
              progress,
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

    return {
      error: error ? false : true,
      tmpDirs: repoInstance?.tmpDirs ?? [],
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

  async exec(session: BackupSessionManager) {
    const [snapshot, packages] = await this.init(session);
    let errors = 0;

    for (const pkg of packages) {
      const id = session.findId({
        packageName: pkg.name,
      });

      await session.start({
        id,
      });

      let targetPath: string | undefined;
      let taskTmpDirs: string[] = [];

      if (pkg.task) {
        const taskInstance = TaskFactory(pkg.task);
        const result = await taskInstance.onBeforeBackup({
          options: this.options,
          package: pkg,
          snapshot,
        });
        const taskResult = await this.task(
          session,
          pkg,
          taskInstance,
          snapshot,
          (targetPath = result?.targetPath),
        );
        taskTmpDirs.push(...taskResult.tmpDirs);
      }

      const { repoNames, mirrors } = this.splitRepositories(
        pkg.repositoryNames ?? [],
      );

      for (const repoName of repoNames) {
        const repo = findRepositoryOrFail(this.config, repoName);
        const { tmpDirs } = await this.backup(
          session,
          pkg,
          repo,
          snapshot,
          targetPath,
        );
        if (!this.options.verbose) await rmTmpDir(tmpDirs);
      }

      if (!this.options.verbose) {
        await rmTmpDir(taskTmpDirs);
        if (pkg.path && isTmpDir(pkg.path)) {
          await rmTmpDir(pkg.path);
        }
      }

      for (const mirror of mirrors) {
        const repo = findRepositoryOrFail(this.config, mirror.sourceName);
        const mirrorRepo = findRepositoryOrFail(this.config, mirror.name);
        const { tmpDirs } = await this.copyBackup(
          session,
          pkg,
          repo,
          mirrorRepo,
          snapshot,
        );
        if (!this.options.verbose) await rmTmpDir(tmpDirs);
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
      total: packages.length,
      errors: errors,
    };
  }
}
