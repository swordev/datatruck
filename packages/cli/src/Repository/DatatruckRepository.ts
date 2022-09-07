import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../util/cli-util";
import { parsePaths } from "../util/datatruck/paths-util";
import {
  applyPermissions,
  checkDir,
  checkFile,
  cpy,
  fastFolderSizeAsync,
  isEmptyDir,
  mkdirIfNotExists,
  mkTmpDir,
  parsePackageFile,
  pathIterator,
  readDir,
  waitForClose,
} from "../util/fs-util";
import { progressPercent } from "../util/math-util";
import { Progress } from "../util/progress";
import { checkMatch, checkPath, makePathPatterns } from "../util/string-util";
import { listZip, unzip, zip } from "../util/zip-util";
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
import fg, { Entry, Options } from "fast-glob";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, readFile, writeFile, rm, copyFile, opendir } from "fs/promises";
import type { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { join, resolve } from "path";
import { performance } from "perf_hooks";
import { createInterface } from "readline";

export type MetaDataType = {
  id: string;
  date: string;
  package: string;
  task: string | undefined;
  tags: string[];
  version: string;
  size: number;
};

export type DatatruckRepositoryConfigType = {
  outPath: string;
  compress?: boolean;
  /**
   * @default 1
   */
  fileCopyConcurrency?: number;
};

type CompressObjectType = {
  packs?: {
    name?: string;
    include: string[];
    exclude?: string[];
    onePackByResult?: boolean;
  }[];
};

export type DatatruckPackageRepositoryConfigType = {
  compress?: CompressObjectType | boolean;
};

export const datatruckRepositoryName = "datatruck";

export const datatruckRepositoryDefinition: JSONSchema7 = {
  type: "object",
  required: ["outPath"],
  additionalProperties: false,
  properties: {
    outPath: { type: "string" },
    compress: { type: "boolean" },
  },
};

export const datatruckPackageRepositoryDefinition: JSONSchema7 = {
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
                  name: { type: "string" },
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

export class DatatruckRepository extends RepositoryAbstract<DatatruckRepositoryConfigType> {
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

  private async createFileScanner(options: {
    glob: Options & {
      include: string[];
    };
    onProgress: (data: Progress) => Promise<void>;
    disableCounting?: boolean;
  }) {
    const object = {
      total: 0,
      current: 0,
      progress: async (
        description: string,
        data: {
          path?: string;
          current: number;
          type?: "start" | "end";
          percent?: number;
        }
      ) => {
        await options.onProgress({
          relative: {
            description,
            payload: data.path,
            percent: data.percent,
          },
          absolute: {
            total: object.total,
            current: object.current + data.current,
            percent: progressPercent(
              object.total,
              object.current + data.current
            ),
          },
        });
        if (data.type === "end") {
          object.current += data.current;
        }
      },
      start: async (cb?: (entry: Required<Entry>) => any) => {
        for await (const entry of pathIterator(stream)) {
          if (!options.disableCounting) object.total++;
          const currentTime = performance.now();
          const diff = currentTime - lastTime;
          if (diff > 1_000) {
            await options.onProgress({
              relative: {
                description: "Scanning files",
                payload: object.total.toString(),
              },
            });
            lastTime = currentTime;
          }
          if (cb) await cb(entry);
        }
        await options.onProgress({
          relative: {
            description: "Scanned files",
            payload: object.total.toString(),
          },
        });
      },
    };

    await options.onProgress({
      relative: {
        description: "Scanning files",
      },
    });

    const stream = fg.stream(options.glob.include, {
      dot: true,
      markDirectories: true,
      stats: true,
      ...options.glob,
    });

    let lastTime = performance.now();

    return object;
  }

  override async onPrune(data: PruneDataType) {
    const snapshotName = DatatruckRepository.buildSnapshotName({
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
      const snapshotNameData =
        DatatruckRepository.parseSnapshotName(snapshotName);
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
      const meta = await DatatruckRepository.parseMetaData(metaPath);

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
        size: meta.size || 0,
      });
    }

    return snapshots;
  }

  private normalizeCompressConfig(
    packageConfig: DatatruckPackageRepositoryConfigType | undefined
  ): CompressObjectType | undefined {
    let compress = packageConfig?.compress ?? this.config.compress;
    if (compress === true || (compress && !Array.isArray(compress.packs))) {
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
    data: BackupDataType<DatatruckPackageRepositoryConfigType>
  ) {
    const snapshotName = DatatruckRepository.buildSnapshotName({
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

    const packs = compress?.packs || [];
    const tmpDir = await mkTmpDir("path-lists");
    const nonPackStream = createWriteStream(join(tmpDir, "nonpack.txt"));
    const singlePackStream = createWriteStream(join(tmpDir, "single-pack.txt"));
    const packStreams = Array.from({ length: packs.length }).map((v, i) =>
      createWriteStream(join(tmpDir, `pack-${i}.txt`))
    );

    const streams = [nonPackStream, singlePackStream, ...packStreams];

    if (data.options.verbose) logExec(`Writing file lists in ${tmpDir}`);

    const scanner = await this.createFileScanner({
      glob: {
        include,
        cwd: sourcePath,
        ignore: exclude,
        onlyFiles: false,
      },
      onProgress: data.onProgress,
      disableCounting: true,
    });

    await Promise.all([
      ...streams.map((p) => waitForClose(p)),
      (async () => {
        await scanner.start(async (entry) => {
          const pathSubject = entry.stats.isDirectory()
            ? entry.path.slice(0, -1)
            : entry.path;
          let stream = nonPackStream;
          let successPackIndex: number | undefined;

          for (const [packIndex, pack] of packs.entries()) {
            if (checkPath(pathSubject, pack.include, pack.exclude)) {
              stream = pack.onePackByResult
                ? singlePackStream
                : packStreams[packIndex];
              successPackIndex = packIndex;
              break;
            }
          }

          const isNonPackStream = stream === nonPackStream;
          const isPackStream = stream !== nonPackStream;
          const isSinglePackStream = stream === singlePackStream;
          const include = isPackStream
            ? entry.stats.isDirectory()
              ? await isEmptyDir(join(sourcePath, entry.path))
              : true
            : true;

          if (include) {
            let value = entry.path;
            if (isNonPackStream) {
              value += `:${entry.stats.uid}:${entry.stats.gid}:${entry.stats.mode}`;
            } else if (isSinglePackStream) {
              value += `:${successPackIndex}`;
            }
            if (!entry.stats.isDirectory()) scanner.total++;
            stream.write(`${value}\n`);
          }
        });

        for (const stream of streams) {
          stream.end();
        }
      })(),
    ]);

    const dttFolder = `.dtt-${data.snapshot.id.slice(0, 8)}`;
    const dttPath = join(outPath, dttFolder);
    await mkdir(dttPath);

    await copyFile(nonPackStream.path, join(dttPath, "permissions.txt"));

    // Non pack

    if (data.options.verbose)
      logExec(
        `Copying files from ${nonPackStream.path.toString()} to ${outPath}`
      );

    await cpy({
      input: {
        type: "pathList",
        path: nonPackStream.path.toString(),
        basePath: sourcePath,
      },
      targetPath: outPath,
      skipNotFoundError: true,
      concurrency: this.config.fileCopyConcurrency,
      onProgress: async (progress) =>
        await scanner.progress(
          progress.type === "end" ? "Files copied" : "Copying file",
          progress
        ),
    });

    // Single pack

    const singleReader = createInterface({
      input: createReadStream(singlePackStream.path),
    });

    for await (const line of singleReader) {
      let [packPath, packIndex] = line.split(":");
      const pack = packs[packIndex as any];

      if (packPath.endsWith("/")) packPath = packPath.slice(0, -1);

      const outBasename = (
        `pack${pack.name ? `-${encodeURIComponent(pack.name)}` : ""}` +
        `-${encodeURIComponent(packPath.replace(/[\\/]/g, "-"))}` +
        `.zip`
      ).slice(0, 255);

      const target = join(dttPath, outBasename);

      await zip({
        path: pkg.path as string,
        output: target,
        filter: [{ patterns: [packPath] }],
        verbose: data.options.verbose,
        onProgress: async (progress) =>
          await scanner.progress(
            progress.type === "start"
              ? "Starting compressing"
              : "Compressing file",
            progress
          ),
      });
    }

    // Packs

    for (const [packIndex, packStream] of packStreams.entries()) {
      const pack = packs[packIndex];
      const target = join(
        dttPath,
        `pack-${packIndex}${pack.name ? `-${pack.name}` : ""}.zip`
      );
      await zip({
        path: sourcePath,
        output: target,
        includeList: packStream.path.toString(),
        verbose: data.options.verbose,
        onProgress: async (progress) =>
          await scanner.progress(
            progress.type === "start"
              ? "Starting compressing"
              : "Compressing file",
            progress
          ),
      });
    }

    // Meta

    const metaPath = `${outPath}.json`;
    const nodePkg = parsePackageFile();
    const meta: MetaDataType = {
      id: data.snapshot.id,
      date: data.snapshot.date,
      tags: data.options.tags ?? [],
      package: data.package.name,
      task: data.package.task?.name,
      version: nodePkg.version,
      size:
        (await fastFolderSizeAsync(outPath)) -
        (await fastFolderSizeAsync(dttPath)),
    };
    if (data.options.verbose) logExec(`Writing metadata into ${metaPath}`);
    await writeFile(metaPath, DatatruckRepository.stringifyMetaData(meta));
  }

  override async onCopyBackup(
    data: CopyBackupType<DatatruckRepositoryConfigType>
  ): Promise<void> {
    const snapshotName = DatatruckRepository.buildSnapshotName({
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

    if (data.options.verbose) logExec(`Copying backup files to ${targetPath}`);

    await mkdir(targetPath);

    const scanner = await this.createFileScanner({
      glob: {
        include: ["**/*"],
        cwd: sourcePath,
      },
      onProgress: data.onProgress,
    });

    await scanner.start();

    await cpy({
      input: {
        type: "glob",
        sourcePath,
      },
      targetPath,
      onProgress: async (progress) =>
        await scanner.progress(
          progress.type === "end" ? "Files copied" : "Copying file",
          progress
        ),
    });

    await copyFile(sourceMetaPath, targetMetaPath);
  }

  override async onRestore(
    data: RestoreDataType<DatatruckPackageRepositoryConfigType>
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

    const snapshotName = DatatruckRepository.buildSnapshotName({
      snapshotId: data.snapshot.id,
      snapshotDate: data.snapshot.date,
      packageName: data.package.name,
    });

    const sourcePath = join(this.config.outPath, snapshotName);
    const dttFolder = `.dtt-${data.snapshot.id.slice(0, 8)}`;
    const dttPath = join(sourcePath, dttFolder);
    const scanner = await this.createFileScanner({
      glob: {
        include: ["**/*"],
        cwd: sourcePath,
        ignore: [dttFolder],
      },
      onProgress: data.onProgress,
    });

    await scanner.start();
    const dttPathExists = await checkDir(dttPath);
    if (dttPathExists) {
      const it = await opendir(dttPath);
      for await (const dirent of it) {
        const path = join(dttPath, dirent.name);
        if (dirent.name === "permissions.txt") {
          scanner.total++;
        } else if (dirent.name.endsWith(".zip")) {
          await listZip({
            path,
            verbose: data.options.verbose,
            onStream: async (item) => {
              const isDir = item.Folder === "+";
              if (!isDir) scanner.total++;
            },
          });
        }
      }
    }

    if (data.options.verbose) logExec(`Copying files to ${restorePath}`);

    await cpy({
      input: {
        type: "glob",
        sourcePath,
        exclude: [dttFolder],
      },
      targetPath: restorePath,
      concurrency: this.config.fileCopyConcurrency,
      onProgress: async (progress) =>
        await scanner.progress(
          progress.type === "end" ? "Files copied" : "Copying file",
          progress
        ),
    });
    if (dttPathExists) {
      const it = await opendir(dttPath);
      for await (const dirent of it) {
        const path = join(dttPath, dirent.name);
        if (dirent.name === "permissions.txt") {
          if (data.options.verbose) logExec(`Applying permissions (${path})`);
          await scanner.progress("Applying permissions", {
            current: 0,
          });
          await applyPermissions(restorePath, path);
          await scanner.progress("Permissions applied", {
            current: 1,
            type: "end",
          });
        } else if (dirent.name.endsWith(".zip")) {
          await unzip({
            input: path,
            output: restorePath,
            verbose: data.options.verbose,
            onProgress: async (progress) =>
              await scanner.progress(
                progress.type === "start"
                  ? "Starting extracting"
                  : "Extracting file",
                progress
              ),
          });
        }
      }
    }
  }
}
