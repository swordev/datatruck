import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../util/cli-util";
import { parsePaths } from "../util/datatruck/paths-util";
import {
  checkDir,
  checkFile,
  cpy,
  forEachFile,
  mkdirIfNotExists,
  parsePackageFile,
  readDir,
  writePathLists,
} from "../util/fs-util";
import { progressPercent } from "../util/math-util";
import { checkMatch, makePathPatterns } from "../util/string-util";
import { unzip, zip } from "../util/zip-util";
import {
  RepositoryAbstract,
  BackupDataType,
  InitDataType,
  RestoreDataType,
  SnapshotsDataType,
  SnapshotResultType,
  PruneDataType,
  CopyBackupType,
} from "./RepositoryAbstract";
import { ok } from "assert";
import fg from "fast-glob";
import { createReadStream } from "fs";
import { mkdir, readFile, writeFile, rm, copyFile } from "fs/promises";
import type { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { basename, join, resolve } from "path";
import { createInterface } from "readline";

export type MetaDataType = {
  id: string;
  date: string;
  package: string;
  task: string | undefined;
  tags: string[];
  version: string;
};

export type LocalRepositoryConfigType = {
  outPath: string;
  compress?: boolean;
  /**
   * @default 1
   */
  fileCopyConcurrency?: number;
};

type CompressObjectType = {
  packs?: {
    include: string[];
    exclude?: string[];
    onePackByResult?: boolean;
  }[];
};

export type LocalPackageRepositoryConfigType = {
  compress?: CompressObjectType | boolean;
};

export const localRepositoryName = "local";

export const localRepositoryDefinition: JSONSchema7 = {
  type: "object",
  required: ["outPath"],
  additionalProperties: false,
  properties: {
    outPath: { type: "string" },
    compress: { type: "boolean" },
  },
};

export const localPackageRepositoryDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    compress: {
      anyOf: [
        {
          type: "boolean",
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            packs: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["include"],
                properties: {
                  include: makeRef(DefinitionEnum.stringListUtil),
                  exclude: makeRef(DefinitionEnum.stringListUtil),
                  onePackByResult: { type: "boolean" },
                },
              },
            },
          },
        },
      ],
    },
    fileCopyConcurrency: {
      type: "integer",
      minimum: 1,
    },
  },
};

export class LocalRepository extends RepositoryAbstract<LocalRepositoryConfigType> {
  static zipBasenameTpl = `.*.dd.zip`;

  static buildSnapshotName(data: {
    snapshotId: string;
    snapshotDate: string;
    packageName: string;
  }) {
    const date = data.snapshotDate.replace(/:/g, "-");
    const pkgName = encodeURIComponent(data.packageName).replace(/%40/g, "@");
    const snapshotShortId = data.snapshotId.slice(0, 8);
    return `${date}_${pkgName}_${snapshotShortId}`;
  }

  static parseSnapshotName(name: string) {
    if (!name.endsWith(".json")) return null;
    name = name.replace(/\.json$/, "");
    const nameParts = name.split("_");
    if (nameParts.length !== 3) return null;
    let [snapshotDate, packageName, snapshotShortId] = nameParts;
    const [date, time] = snapshotDate.split("T");
    snapshotDate = `${date}T${time.replace(/-/g, ":")}`;
    packageName = decodeURIComponent(packageName);
    return { snapshotDate, packageName, snapshotShortId, sourcePath: name };
  }

  protected buildMetaPath(snapshotName: string, packageName: string) {
    return join(this.config.outPath, snapshotName, packageName) + ".meta.json";
  }

  static async parseMetaData(path: string) {
    const contents = await readFile(path);
    return JSON.parse(contents.toString()) as MetaDataType;
  }

  static stringifyMetaData(data: MetaDataType) {
    return JSON.stringify(data);
  }

  override onGetSource() {
    return this.config.outPath;
  }

  override async onInit(data: InitDataType) {
    await mkdirIfNotExists(this.config.outPath);
  }

  override async onPrune(data: PruneDataType) {
    const snapshotName = LocalRepository.buildSnapshotName({
      snapshotId: data.snapshot.id,
      snapshotDate: data.snapshot.date,
      packageName: data.snapshot.packageName,
    });
    const snapshotPath = join(this.config.outPath, snapshotName);
    const metaPath = `${snapshotPath}.json`;

    if (data.options.verbose) logExec(`Deleting ${snapshotPath}`);
    if (await checkDir(snapshotPath))
      await rm(snapshotPath, {
        recursive: true,
      });
    if (await checkFile(metaPath)) await rm(metaPath);
  }

  override async onSnapshots(data: SnapshotsDataType) {
    if (!(await checkDir(this.config.outPath)))
      throw new Error(
        `Repository (${this.repository.name}) out path does not exist: ${this.config.outPath}`
      );
    const snapshotNames = await readDir(this.config.outPath);
    const snapshots: SnapshotResultType[] = [];
    const packagePatterns = makePathPatterns(data.options.packageNames);
    const taskPatterns = makePathPatterns(data.options.packageTaskNames);

    for (const snapshotName of snapshotNames) {
      const snapshotNameData = LocalRepository.parseSnapshotName(snapshotName);
      if (!snapshotNameData) continue;
      if (
        packagePatterns &&
        !isMatch(snapshotNameData.packageName, packagePatterns)
      )
        continue;

      if (
        data.options.ids &&
        !data.options.ids.some((id) =>
          snapshotNameData.snapshotShortId.startsWith(id.slice(0, 8))
        )
      )
        continue;

      const metaPath = join(this.config.outPath, snapshotName);
      const meta = await LocalRepository.parseMetaData(metaPath);

      if (taskPatterns && !checkMatch(meta.task, taskPatterns)) continue;

      if (
        data.options.ids &&
        !data.options.ids.some((id) => meta.id.startsWith(id))
      )
        continue;
      if (
        data.options.tags &&
        !data.options.tags.some((value) => data.options.tags?.includes(value))
      )
        continue;

      snapshots.push({
        originalId: snapshotName,
        id: meta.id,
        date: meta.date,
        packageName: meta.package,
        packageTaskName: meta.task,
        tags: meta.tags,
      });
    }

    return snapshots;
  }

  private normalizeCompressConfig(
    packageConfig: LocalPackageRepositoryConfigType | undefined
  ): CompressObjectType | undefined {
    let compress = packageConfig?.compress ?? this.config.compress;
    if (compress === true) {
      return {
        packs: [
          {
            include: ["**"],
          },
        ],
      };
    } else if (!compress) {
      return undefined;
    }
    return compress;
  }

  override async onBackup(
    data: BackupDataType<LocalPackageRepositoryConfigType>
  ) {
    const snapshotName = LocalRepository.buildSnapshotName({
      snapshotId: data.snapshot.id,
      snapshotDate: data.snapshot.date,
      packageName: data.package.name,
    });
    const outPath = resolve(join(this.config.outPath, snapshotName));
    const pkg = data.package;

    await mkdir(outPath, {
      recursive: true,
    });

    const sourcePath = data.targetPath ?? pkg.path;

    ok(sourcePath);

    const compress = this.normalizeCompressConfig(data.packageConfig);

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

    const stream = fg.stream(include, {
      cwd: sourcePath,
      ignore: exclude,
      dot: true,
      onlyFiles: compress ? false : true,
      markDirectories: true,
    });

    if (data.options.verbose) logExec(`Writing paths lists`);
    const pathLists = await writePathLists({
      paths: stream,
      packs: compress?.packs,
    });

    if (data.options.verbose) logExec(`Path lists: ${pathLists.path}`);

    let currentFiles = 0;
    if (compress?.packs) {
      let packIndex = 0;
      for (const packsPath of pathLists.includedPackPaths) {
        const pack = compress.packs[packIndex];

        if (pack.onePackByResult) {
          const reader = createInterface({
            input: createReadStream(packsPath),
          });

          let multipleIndex = 0;
          for await (let packPath of reader) {
            if (packPath.endsWith("/")) packPath = packPath.slice(0, -1);
            const target = join(
              outPath,
              `.${packIndex}-${multipleIndex++}-${encodeURIComponent(
                packPath.replace(/[\\/]/g, "-")
              ).slice(0, 255)}.dd.zip`
            );

            const stats = await zip({
              path: pkg.path as string,
              output: target,
              filter: [{ patterns: [packPath] }],
              excludeList: pathLists.excludedPackPaths[packIndex],
              verbose: data.options.verbose,
              onStream: async (stream) =>
                await data.onProgress({
                  total: pathLists.total.all,
                  current: currentFiles + stream.data.files,
                  percent: progressPercent(
                    pathLists.total.all,
                    currentFiles + stream.data.files
                  ),
                  step: stream.type === "progress" ? stream.data.path : "",
                  stepPercent:
                    stream.type === "progress" ? stream.data.progress : null,
                }),
            });

            currentFiles += stats.files;
          }
        } else {
          const target = join(outPath, `.${packIndex}.dd.zip`);
          const stats = await zip({
            path: sourcePath,
            output: target,
            includeList: packsPath,
            excludeList: pathLists.excludedPackPaths[packIndex],
            verbose: data.options.verbose,
            onStream: async (stream) =>
              await data.onProgress({
                total: pathLists.total.all,
                current: currentFiles + stream.data.files,
                percent: progressPercent(
                  pathLists.total.all,
                  currentFiles + stream.data.files
                ),
                step: stream.type === "progress" ? stream.data.path : "",
              }),
          });
          currentFiles += stats.files;
        }
        packIndex++;
      }
    }

    if (data.options.verbose) logExec(`Copying files to ${outPath}`);

    await cpy({
      input: {
        type: "pathList",
        path: pathLists.path,
        basePath: sourcePath,
      },
      targetPath: outPath,
      concurrency: this.config.fileCopyConcurrency,
      async onPath({ isDir, entryPath }) {
        if (isDir) return;
        currentFiles++;
        await data.onProgress({
          total: pathLists.total.all,
          current: currentFiles,
          percent: progressPercent(pathLists.total.all, currentFiles),
          step: entryPath,
        });
      },
    });

    const metaPath = `${outPath}.json`;
    const nodePkg = parsePackageFile();
    const meta: MetaDataType = {
      id: data.snapshot.id,
      date: data.snapshot.date,
      tags: data.options.tags ?? [],
      package: data.package.name,
      task: data.package.task?.name,
      version: nodePkg.version,
    };
    if (data.options.verbose) logExec(`Writing metadata into ${metaPath}`);
    await writeFile(metaPath, LocalRepository.stringifyMetaData(meta));
  }

  override async onCopyBackup(
    data: CopyBackupType<LocalRepositoryConfigType>
  ): Promise<void> {
    const snapshotName = LocalRepository.buildSnapshotName({
      snapshotId: data.snapshot.id,
      snapshotDate: data.snapshot.date,
      packageName: data.package.name,
    });
    const sourcePath = resolve(join(this.config.outPath, snapshotName));
    const targetPath = resolve(
      join(data.mirrorRepositoryConfig.outPath, snapshotName)
    );
    const sourceMetaPath = `${sourcePath}.json`;
    const targetMetaPath = `${targetPath}.json`;

    if (data.options.verbose) logExec(`Copying files to ${targetPath}`);

    await mkdir(targetPath);

    await cpy({
      input: {
        type: "glob",
        sourcePath,
      },
      targetPath,
    });

    await copyFile(sourceMetaPath, targetMetaPath);
  }

  override async onRestore(
    data: RestoreDataType<LocalPackageRepositoryConfigType>
  ) {
    const relRestorePath = data.targetPath ?? data.package.restorePath;
    ok(relRestorePath);
    const restorePath = resolve(relRestorePath);

    const [snapshot] = await this.onSnapshots({
      options: {
        ids: [data.options.snapshotId],
      },
    });

    if (!snapshot) throw new AppError("Snapshot not found");

    const snapshotName = LocalRepository.buildSnapshotName({
      snapshotId: data.snapshot.id,
      snapshotDate: data.snapshot.date,
      packageName: data.package.name,
    });

    const sourcePath = join(this.config.outPath, snapshotName);

    let totalFiles = 0;
    let currentFiles = -1;

    await forEachFile(
      sourcePath,
      () => {
        totalFiles++;
      },
      true
    );

    if (data.options.verbose) logExec(`Copying files to ${restorePath}`);

    await cpy({
      input: {
        type: "glob",
        sourcePath,
      },
      targetPath: restorePath,
      concurrency: this.config.fileCopyConcurrency,
      onPath: async ({ entryPath, entrySourcePath }) => {
        const isRootFile = basename(entryPath) === entryPath;
        const isZipFile =
          isRootFile &&
          entryPath.startsWith(".") &&
          entryPath.endsWith(".dd.zip");

        await data.onProgress({
          total: totalFiles,
          current: Math.max(currentFiles, 0),
          percent: progressPercent(totalFiles, Math.max(currentFiles, 0)),
          step: entryPath,
        });

        if (isZipFile) {
          await unzip({
            input: entrySourcePath,
            output: restorePath,
            verbose: data.options.verbose,
            onStream: async (stream) =>
              await data.onProgress({
                total: totalFiles,
                current: currentFiles + 1,
                percent: progressPercent(totalFiles, currentFiles + 1),
                step:
                  stream.type === "progress"
                    ? `Extracting ${stream.data.path}`
                    : "",
              }),
          });
        }
        currentFiles++;
        return isZipFile ? false : true;
      },
    });
  }
}
