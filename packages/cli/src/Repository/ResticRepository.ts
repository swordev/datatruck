import { AppError } from "../Error/AppError";
import { RepositoryType, ResticUtil } from "../util/ResticUtil";
import { logExec } from "../util/cli-util";
import { parsePaths } from "../util/datatruck/paths-util";
import {
  mkdirIfNotExists,
  parsePackageFile,
  writeGitIgnoreList,
} from "../util/fs-util";
import { checkMatch, formatUri, makePathPatterns } from "../util/string-util";
import {
  RepositoryAbstract,
  BackupDataType,
  InitDataType,
  RestoreDataType,
  SnapshotsDataType,
  SnapshotResultType,
  SnapshotTagObjectType,
  SnapshotTagEnum,
  PruneDataType,
  ProgressDataType,
  CopyBackupType,
} from "./RepositoryAbstract";
import { ok } from "assert";
import FastGlob from "fast-glob";
import { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { resolve } from "path";

export type ResticRepositoryConfigType = {
  password: string | { path: string };
  repository: RepositoryType;
};

export type ResticPackageRepositoryConfigType = {};

export const resticRepositoryName = "restic";

export const resticRepositoryDefinition: JSONSchema7 = {
  type: "object",
  required: ["password", "repository"],
  additionalProperties: false,
  properties: {
    password: {
      anyOf: [
        { type: "string" },
        {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: { type: "string" },
          },
        },
      ],
    },
    repository: {
      type: "object",
      additionalProperties: false,
      required: ["backend"],
      properties: {
        name: { type: "string" },
        env: {
          type: "object",
          patternProperties: {
            ".+": { type: "string" },
          },
        },
        backend: {
          enum: ["local", "rest", "sftp", "s3", "azure", "gs", "rclone"],
        },
        protocol: {
          enum: ["http", "https"],
        },
        host: { type: "string" },
        username: { type: "string" },
        passwordFile: { type: "string" },
        port: { type: "integer" },
        path: { type: "string" },
      },
    },
  },
};

export const resticPackageRepositoryDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export class ResticRepository extends RepositoryAbstract<ResticRepositoryConfigType> {
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
      RESTIC_REPOSITORY: await ResticUtil.formatRepository(
        this.config.repository
      ),
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
    const result: SnapshotTagObjectType & {
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

  override onGetSource() {
    return formatUri({ ...this.config.repository, password: undefined });
  }

  override async onInit(data: InitDataType) {
    const restic = new ResticUtil({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });

    if (this.config.repository.backend === "local")
      await mkdirIfNotExists(this.env.RESTIC_REPOSITORY);

    if (!(await restic.checkRepository())) await restic.exec(["init"]);
  }

  override async onSnapshots(data: SnapshotsDataType) {
    const restic = new ResticUtil({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });
    const packagePatterns = makePathPatterns(data.options.packageNames);
    const taskNamePatterns = makePathPatterns(data.options.packageTaskNames);
    const result = await restic.snapshots({
      json: true,
      tags: [
        ...(data.options.ids?.map((id) =>
          ResticRepository.buildSnapshotTag(
            id.length === 8 ? SnapshotTagEnum.SHORT_ID : SnapshotTagEnum.ID,
            id
          )
        ) ?? []),
      ],
    });
    return result.reduce((items, item) => {
      const tag = ResticRepository.parseSnapshotTags(item.tags ?? []);
      if (!tag.id) return items;
      if (packagePatterns && !isMatch(tag.package, packagePatterns))
        return items;
      if (taskNamePatterns && !checkMatch(tag.task, taskNamePatterns))
        return items;
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
      });
      return items;
    }, [] as SnapshotResultType[]);
  }

  async onPrune(data: PruneDataType) {
    const restic = new ResticUtil({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });
    await restic.forget({
      snapshotId: data.snapshot.originalId,
      prune: true,
    });
  }

  override async onBackup(
    data: BackupDataType<ResticPackageRepositoryConfigType>
  ) {
    const restic = new ResticUtil({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });

    const pkg = data.package;
    const sourcePath = data.targetPath ?? data.package.path;

    ok(sourcePath);

    let gitignorePath: string | undefined;

    if (pkg.include || pkg.exclude) {
      const include = await parsePaths(pkg.include ?? ["**"], {
        cwd: sourcePath,
        verbose: data.options.verbose,
      });

      const exclude = pkg.exclude
        ? await parsePaths(pkg.exclude, {
            cwd: sourcePath,
            verbose: data.options.verbose,
          })
        : undefined;

      const stream = FastGlob.stream(include, {
        cwd: sourcePath,
        ignore: exclude,
        dot: true,
        onlyFiles: true,
        markDirectories: true,
      });

      if (data.options.verbose) logExec(`Writing paths lists`);

      await data.onProgress({
        step: "Writing excluded paths list...",
      });

      gitignorePath = await writeGitIgnoreList({
        paths: stream,
      });
    }

    if (
      data.options.tags?.some((tag) =>
        tag.startsWith(ResticRepository.refPrefix)
      )
    )
      throw new AppError(`Tag prefix is not allowed`);

    const packageTag = ResticRepository.buildSnapshotTag(
      SnapshotTagEnum.PACKAGE,
      data.package.name
    );

    await data.onProgress({
      step: "Fetching last snapshot...",
    });

    const [lastSnapshot] = await restic.snapshots({
      json: true,
      tags: [packageTag],
      latest: 1,
    });

    const nodePkg = parsePackageFile();

    let lastProgress: ProgressDataType | undefined;
    let totalFilesChanges = 0;
    const totalFilesChangesLimit = 10;

    await data.onProgress({
      step: "Executing backup action...",
    });

    await restic.backup({
      cwd: sourcePath,
      paths: ["."],
      allowEmptySnapshot: true,
      excludeFile: gitignorePath ? [gitignorePath] : undefined,
      parent: lastSnapshot?.id,
      // https://github.com/restic/restic/pull/3200
      ...((await restic.checkBackupSetPathSupport()) && {
        setPaths: [`/datatruck/${data.package.name}`],
      }),
      tags: [
        ResticRepository.buildSnapshotTag(SnapshotTagEnum.ID, data.snapshot.id),
        ResticRepository.buildSnapshotTag(
          SnapshotTagEnum.SHORT_ID,
          data.snapshot.id.slice(0, 8)
        ),
        ResticRepository.buildSnapshotTag(
          SnapshotTagEnum.DATE,
          data.snapshot.date
        ),
        ResticRepository.buildSnapshotTag(
          SnapshotTagEnum.VERSION,
          nodePkg.version
        ),
        packageTag,
        ...(data.package.task?.name
          ? [
              ResticRepository.buildSnapshotTag(
                SnapshotTagEnum.TASK,
                data.package.task?.name
              ),
            ]
          : []),
        ...(data.options.tags ?? []),
      ],
      onStream: async (streamData) => {
        if (streamData.message_type === "status") {
          let showProgressBar = false;
          if (totalFilesChanges > totalFilesChangesLimit) {
            showProgressBar = true;
          } else if (lastProgress?.total !== streamData.total_files) {
            totalFilesChanges = 0;
          } else {
            totalFilesChanges++;
          }
          await data.onProgress(
            (lastProgress = {
              total: Math.max(lastProgress?.total || 0, streamData.total_files),
              current: Math.max(
                lastProgress?.current || 0,
                streamData.files_done ?? 0
              ),
              percent: showProgressBar
                ? Number((streamData.percent_done * 100).toFixed(2))
                : 0,
              step: streamData.current_files?.join(", ") ?? "-",
            })
          );
        }
      },
    });

    await data.onProgress({
      total: lastProgress?.total || 0,
      current: lastProgress?.total || 0,
      percent: 100,
    });
  }

  override async onCopyBackup(
    data: CopyBackupType<ResticRepositoryConfigType>
  ): Promise<void> {
    const config = data.mirrorRepositoryConfig;

    const [snapshot] = await this.onSnapshots({
      options: {
        ids: [data.snapshot.id],
        packageNames: [data.package.name],
      },
    });

    if (!snapshot) throw new AppError(`Snapshot not found`);

    const restic = new ResticUtil({
      env: {
        ...(await this.buildEnv()),
        ...(typeof config.password === "string"
          ? { RESTIC_PASSWORD2: config.password }
          : { RESTIC_PASSWORD_FILE2: resolve(config.password.path) }),
        RESTIC_REPOSITORY2: await ResticUtil.formatRepository(
          config.repository
        ),
      },
      log: data.options.verbose,
    });
    await restic.copy({
      id: snapshot.originalId,
    });
  }

  override async onRestore(
    data: RestoreDataType<ResticPackageRepositoryConfigType>
  ) {
    const restorePath = data.targetPath ?? data.package.restorePath;

    ok(restorePath);

    const restic = new ResticUtil({
      env: await this.buildEnv(),
      log: data.options.verbose,
    });
    const [snapshot] = await this.onSnapshots({
      options: {
        ids: [data.snapshot.id],
        packageNames: [data.package.name],
      },
    });
    if (!snapshot) throw new AppError(`Snapshot not found`);

    await restic.restore({
      id: snapshot.originalId,
      target: restorePath,
    });
  }
}
