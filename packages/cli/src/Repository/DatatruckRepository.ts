import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../utils/cli";
import { parsePaths } from "../utils/datatruck/paths";
import {
  applyPermissions,
  checkDir,
  cpy,
  createFileScanner,
  fastFolderSizeAsync,
  isEmptyDir,
  isNotFoundError,
  mkdirIfNotExists,
  parsePackageFile,
  readDir,
  waitForClose,
} from "../utils/fs";
import { checkMatch, checkPath, makePathPatterns } from "../utils/string";
import { listZip, unzip, zip } from "../utils/zip";
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

  static async parseMetaData(path: string): Promise<MetaDataType | undefined> {
    let contents: Buffer;
    try {
      contents = await readFile(path);
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
    return JSON.parse(contents.toString());
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
    const snapshotName = DatatruckRepository.buildSnapshotName({
      snapshotId: data.snapshot.id,
      snapshotDate: data.snapshot.date,
      packageName: data.snapshot.packageName,
    });
    const snapshotPath = join(this.config.outPath, snapshotName);

    if (data.options.verbose) logExec(`Deleting ${snapshotPath}`);
    if (await checkDir(snapshotPath))
      await rm(snapshotPath, {
        recursive: true,
      });
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

      const metaPath = join(this.config.outPath, snapshotName, "meta.json");
      const meta = await DatatruckRepository.parseMetaData(metaPath);

      if (!meta) continue;

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
    const tmpDir = await this.mkTmpDir("path-lists");
    const unpackedStream = createWriteStream(join(tmpDir, "unpacked.txt"));
    const singlePackStream = createWriteStream(join(tmpDir, "single-pack.txt"));
    const packStreams = Array.from({ length: packs.length }).map((v, i) =>
      createWriteStream(join(tmpDir, `pack-${i}.txt`))
    );

    const streams = [unpackedStream, singlePackStream, ...packStreams];

    if (data.options.verbose) logExec(`Writing file lists in ${tmpDir}`);

    const scanner = await createFileScanner({
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
          let stream = unpackedStream;
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

          const isUnpackedStream = stream === unpackedStream;
          const isPackStream = stream !== unpackedStream;
          const isSinglePackStream = stream === singlePackStream;
          const include = isPackStream
            ? entry.stats.isDirectory()
              ? await isEmptyDir(join(sourcePath, entry.path))
              : true
            : true;

          if (include) {
            let value = entry.path;
            if (isUnpackedStream) {
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

    const unpackedPath = join(outPath, "unpacked");

    await mkdir(unpackedPath);

    await copyFile(unpackedStream.path, join(outPath, "permissions.txt"));

    // Non pack

    if (data.options.verbose)
      logExec(
        `Copying files from ${unpackedStream.path.toString()} to ${unpackedPath}`
      );

    await cpy({
      input: {
        type: "pathList",
        path: unpackedStream.path.toString(),
        basePath: sourcePath,
      },
      targetPath: unpackedPath,
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

      const target = join(outPath, outBasename);

      await zip({
        path: pkg.path as string,
        output: target,
        filter: [{ patterns: [packPath] }],
        verbose: data.options.verbose,
        onProgress: async (progress) =>
          await scanner.progress("Compressing file", progress),
      });
    }

    // Packs

    for (const [packIndex, packStream] of packStreams.entries()) {
      const pack = packs[packIndex];
      const target = join(
        outPath,
        `pack-${packIndex}${pack.name ? `-${pack.name}` : ""}.zip`
      );
      await zip({
        path: sourcePath,
        output: target,
        includeList: packStream.path.toString(),
        verbose: data.options.verbose,
        onProgress: async (progress) =>
          await scanner.progress("Compressing file", progress),
      });
    }

    // Meta

    const metaPath = `${outPath}/meta.json`;
    const nodePkg = parsePackageFile();
    const meta: MetaDataType = {
      id: data.snapshot.id,
      date: data.snapshot.date,
      tags: data.options.tags ?? [],
      package: data.package.name,
      task: data.package.task?.name,
      version: nodePkg.version,
      size: await fastFolderSizeAsync(outPath),
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

    if (data.options.verbose) logExec(`Copying backup files to ${targetPath}`);

    await mkdir(targetPath);

    const scanner = await createFileScanner({
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

    const scanner = await createFileScanner({
      glob: {
        include: ["unpacked/**/*"],
        cwd: sourcePath,
      },
      onProgress: data.onProgress,
      disableEndProgress: true,
    });

    await scanner.start();

    const it = await opendir(sourcePath);
    for await (const dirent of it) {
      const path = join(sourcePath, dirent.name);
      if (dirent.name === "permissions.txt") {
        scanner.total++;
        await scanner.updateProgress();
      } else if (dirent.name.endsWith(".zip")) {
        await listZip({
          path,
          verbose: data.options.verbose,
          onStream: async (item) => {
            const isDir = item.Folder === "+";
            if (!isDir) scanner.total++;
            await scanner.updateProgress();
          },
        });
      }
    }

    await scanner.updateProgress(true);

    if (data.options.verbose) logExec(`Copying files to ${restorePath}`);

    await cpy({
      input: {
        type: "glob",
        sourcePath: join(sourcePath, "unpacked"),
      },
      targetPath: restorePath,
      concurrency: this.config.fileCopyConcurrency,
      onProgress: async (progress) =>
        await scanner.progress(
          progress.type === "end" ? "Files copied" : "Copying file",
          progress
        ),
    });

    const it2 = await opendir(sourcePath);
    for await (const dirent of it2) {
      const path = join(sourcePath, dirent.name);
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
            await scanner.progress("Extracting file", progress),
        });
      }
    }
  }
}
