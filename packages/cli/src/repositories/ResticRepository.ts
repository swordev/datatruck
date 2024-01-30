import { logExec } from "../utils/cli";
import { createPkgFilter, createTaskFilter } from "../utils/datatruck/config";
import { BackupPathsOptions, parseBackupPaths } from "../utils/datatruck/paths";
import { AppError } from "../utils/error";
import {
  fastglobToGitIgnore,
  fetchDiskStats,
  mkdirIfNotExists,
  parsePackageFile,
  writeGitIgnoreList,
} from "../utils/fs";
import { progressPercent } from "../utils/math";
import { Progress } from "../utils/progress";
import { ResticRepositoryUri, Restic } from "../utils/restic";
import { formatUri } from "../utils/string";
import { mkTmpDir } from "../utils/temp";
import {
  RepositoryAbstract,
  RepoBackupData,
  RepoInitData,
  RepoRestoreData,
  RepoFetchSnapshotsData,
  Snapshot,
  SnapshotTagObject,
  SnapshotTagEnum,
  RepoPruneData,
  RepoCopyData,
} from "./RepositoryAbstract";
import FastGlob from "fast-glob";
import { writeFile } from "fs/promises";
import { join, resolve } from "path";

export type ResticRepositoryConfig = {
  password: string | { path: string };
  repository: ResticRepositoryUri;
};

export type ResticPackageRepositoryConfig = {};

export const resticRepositoryName = "restic";

export class ResticRepository extends RepositoryAbstract<ResticRepositoryConfig> {
  static refPrefix = "dt-";

  protected env!: {
    RESTIC_PASSWORD?: string;
    RESTIC_PASSWORD_FILE?: string;
    RESTIC_REPOSITORY: string;
  };

  async buildEnv() {
    if (this.env) return this.env;
    return (this.env = {
      ...(typeof this.config.password === "string"
        ? { RESTIC_PASSWORD: this.config.password }
        : { RESTIC_PASSWORD_FILE: resolve(this.config.password.path) }),
      RESTIC_REPOSITORY: await Restic.formatRepository(this.config.repository),
    });
  }

  static buildSnapshotTag(name: SnapshotTagEnum, value: string) {
    return `${ResticRepository.refPrefix}${name}:${value}`;
  }

  static parseSnapshotTag(tag: string) {
    for (const metaName in SnapshotTagEnum) {
      const name = (SnapshotTagEnum as any)[metaName];
      const prefix = `${ResticRepository.refPrefix}${name}:`;
      if (tag.startsWith(prefix))
        return {
          name: name as SnapshotTagEnum,
          value: tag.slice(prefix.length),
        };
    }
    return null;
  }

  static parseSnapshotTags(tags: string[]) {
    const result: SnapshotTagObject & {
      tags: string[];
    } = {
      tags: [],
    } as any;
    for (const tag of tags) {
      const tagItem = ResticRepository.parseSnapshotTag(tag);
      if (tagItem && tagItem.name !== "tags") {
        result[tagItem.name] = tagItem.value;
      } else {
        result.tags.push(tag);
      }
    }
    return result as typeof result;
  }

  override getSource() {
    return formatUri({ ...this.config.repository, password: undefined });
  }
  override async fetchDiskStats(config: ResticRepositoryConfig) {
    if (config.repository.backend === "local" && config.repository.path)
      return fetchDiskStats(config.repository.path);
  }
  override async init(data: RepoInitData) {
    const restic = new Restic({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });

    if (this.config.repository.backend === "local")
      await mkdirIfNotExists(this.env.RESTIC_REPOSITORY);

    if (!(await restic.checkRepository())) await restic.exec(["init"]);
  }

  override async fetchSnapshots(data: RepoFetchSnapshotsData) {
    const restic = new Restic({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });
    const result = await restic.snapshots({
      json: true,
      tags: [
        ...(data.options.ids?.map((id) =>
          ResticRepository.buildSnapshotTag(
            id.length === 8 ? SnapshotTagEnum.SHORT_ID : SnapshotTagEnum.ID,
            id,
          ),
        ) ?? []),
      ],
    });
    const filterPkg = createPkgFilter(data.options.packageNames);
    const filterTask = createTaskFilter(data.options.packageTaskNames);

    return result.reduce((items, item) => {
      const tag = ResticRepository.parseSnapshotTags(item.tags ?? []);
      if (!tag.id) return items;
      if (!filterPkg(tag.package)) return items;
      if (!filterTask(tag.task)) return items;
      const itemTags = tag.tags ?? [];
      if (data.options.tags && !itemTags.some((t) => itemTags.includes(t)))
        return items;
      items.push({
        originalId: item.id,
        packageName: tag.package,
        packageTaskName: tag.task,
        date: tag.date,
        id: tag.id,
        tags: itemTags,
        size: Number(tag.size) || 0,
      });
      return items;
    }, [] as Snapshot[]);
  }

  async prune(data: RepoPruneData) {
    const restic = new Restic({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });
    await restic.forget({
      snapshotId: data.snapshot.originalId,
      prune: true,
    });
  }

  override async backup(data: RepoBackupData<ResticPackageRepositoryConfig>) {
    const restic = new Restic({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });

    const pkg = data.package;
    const path = data.package.path;

    let gitignorePath: string | undefined;

    const backupPathsOptions: BackupPathsOptions = {
      package: data.package,
      snapshot: data.snapshot,
      path,
      verbose: data.options.verbose,
    };

    if (!pkg.include && pkg.exclude) {
      const exclude = await parseBackupPaths(pkg.exclude, backupPathsOptions);

      data.onProgress({
        relative: {
          description: "Writing excluded paths list",
        },
      });

      const tmpDir = await mkTmpDir(
        resticRepositoryName,
        "repo",
        "backup",
        "exclude",
      );
      const ignoredContents = fastglobToGitIgnore(exclude, path).join("\n");
      gitignorePath = join(tmpDir, "ignored.txt");

      await writeFile(gitignorePath, ignoredContents);
    } else if (pkg.include || pkg.exclude) {
      const include = await parseBackupPaths(
        pkg.include ?? ["**"],
        backupPathsOptions,
      );

      const exclude = pkg.exclude
        ? await parseBackupPaths(pkg.exclude, backupPathsOptions)
        : undefined;

      const stream = FastGlob.stream(include, {
        cwd: path,
        ignore: exclude,
        dot: true,
        onlyFiles: true,
        markDirectories: true,
      });

      if (data.options.verbose) logExec(`Writing paths lists`);

      data.onProgress({
        relative: {
          description: "Writing excluded paths list",
        },
      });

      gitignorePath = await writeGitIgnoreList({
        paths: stream,
        outDir: await mkTmpDir(
          resticRepositoryName,
          "repo",
          "backup",
          "gitignore",
        ),
      });
    }

    if (
      data.options.tags?.some((tag) =>
        tag.startsWith(ResticRepository.refPrefix),
      )
    )
      throw new AppError(`Tag prefix is not allowed`);

    const packageTag = ResticRepository.buildSnapshotTag(
      SnapshotTagEnum.PACKAGE,
      data.package.name,
    );

    data.onProgress({
      relative: {
        description: "Fetching last snapshot",
      },
    });

    const [lastSnapshot] = await restic.snapshots({
      json: true,
      tags: [packageTag],
      latest: 1,
    });

    const nodePkg = parsePackageFile();

    let lastProgress: Progress | undefined;
    let totalFilesChanges = 0;
    const totalFilesChangesLimit = 10;

    data.onProgress({
      relative: {
        description: "Executing backup action",
      },
    });

    let resticSnapshotId: string | undefined;
    let resticTotalBytes: number | undefined;

    await restic.backup({
      cwd: path,
      paths: ["."],
      allowEmptySnapshot: true,
      excludeFile: gitignorePath ? [gitignorePath] : undefined,
      parent: lastSnapshot?.id,
      tags: [
        ResticRepository.buildSnapshotTag(SnapshotTagEnum.ID, data.snapshot.id),
        ResticRepository.buildSnapshotTag(
          SnapshotTagEnum.SHORT_ID,
          data.snapshot.id.slice(0, 8),
        ),
        ResticRepository.buildSnapshotTag(
          SnapshotTagEnum.DATE,
          data.snapshot.date,
        ),
        ResticRepository.buildSnapshotTag(
          SnapshotTagEnum.VERSION,
          nodePkg.version,
        ),
        packageTag,
        ...(data.package.task?.name
          ? [
              ResticRepository.buildSnapshotTag(
                SnapshotTagEnum.TASK,
                data.package.task?.name,
              ),
            ]
          : []),
        ...(data.options.tags ?? []),
      ],
      createEmptyDir: async () =>
        await mkTmpDir(resticRepositoryName, "repo", "backup", "empty-dir"),
      onStream: async (streamData) => {
        if (streamData.message_type === "status") {
          let showProgressBar = false;
          if (totalFilesChanges > totalFilesChangesLimit) {
            showProgressBar = true;
          } else if (lastProgress?.absolute?.total !== streamData.total_files) {
            totalFilesChanges = 0;
          } else {
            totalFilesChanges++;
          }
          data.onProgress(
            (lastProgress = {
              relative: {
                description: "Copying file",
                payload: streamData.current_files?.join(", ") ?? "-",
              },
              absolute: {
                total: Math.max(
                  lastProgress?.absolute?.total || 0,
                  streamData.total_files || 0,
                ),
                current: Math.max(
                  lastProgress?.absolute?.current || 0,
                  streamData.files_done ?? 0,
                ),
                percent: showProgressBar
                  ? Number((streamData.percent_done * 100).toFixed(2))
                  : 0,
              },
            }),
          );
        } else if (streamData.message_type === "summary") {
          resticSnapshotId = streamData.snapshot_id;
          resticTotalBytes = streamData.total_bytes_processed;
        }
      },
    });

    if (typeof resticSnapshotId !== "string")
      throw new AppError(`Restic snapshot id is is not defined`);

    if (typeof resticTotalBytes !== "number")
      throw new AppError(`Restic snapshot total bytes is not defined`);

    const sizeTag = ResticRepository.buildSnapshotTag(
      SnapshotTagEnum.SIZE,
      resticTotalBytes.toString(),
    );

    await restic.exec(["tag", "--add", sizeTag, resticSnapshotId]);

    data.onProgress({
      absolute: {
        total: lastProgress?.absolute?.total || 0,
        current: lastProgress?.absolute?.total || 0,
        percent: 100,
      },
    });
    return {
      bytes: resticTotalBytes,
    };
  }

  override async copy(data: RepoCopyData<ResticRepositoryConfig>) {
    const config = data.mirrorRepositoryConfig;

    const [snapshot] = await this.fetchSnapshots({
      options: {
        ids: [data.snapshot.id],
        packageNames: [data.package.name],
        verbose: data.options.verbose,
      },
    });

    if (!snapshot) throw new AppError(`Snapshot not found`);

    const restic = new Restic({
      env: {
        ...(await this.buildEnv()),
        ...(typeof config.password === "string"
          ? { RESTIC_PASSWORD2: config.password }
          : { RESTIC_PASSWORD_FILE2: resolve(config.password.path) }),
        RESTIC_REPOSITORY2: await Restic.formatRepository(config.repository),
      },
      log: data.options.verbose,
    });
    let bytes = 0;
    await restic.copy({
      id: snapshot.originalId,
      onStream(data) {
        if (data.message_type === "status") {
          bytes = data.total_bytes;
        }
      },
    });
    return { bytes };
  }

  override async restore(data: RepoRestoreData<ResticPackageRepositoryConfig>) {
    const restorePath = data.snapshotPath;

    const restic = new Restic({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });
    const [snapshot] = await this.fetchSnapshots({
      options: {
        ids: [data.snapshot.id],
        packageNames: [data.package.name],
      },
    });
    if (!snapshot) throw new AppError(`Snapshot not found`);

    await restic.restore({
      id: snapshot.originalId,
      target: restorePath,
      onStream: (streamData) => {
        if (streamData.message_type === "restore-status") {
          const current = Math.min(streamData.total_bytes, snapshot.size);
          data.onProgress({
            absolute: {
              total: snapshot.size,
              current,
              percent: progressPercent(snapshot.size, current),
            },
          });
        }
      },
    });
  }
}
