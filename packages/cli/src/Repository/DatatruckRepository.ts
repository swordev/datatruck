import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../utils/cli";
import { parsePaths } from "../utils/datatruck/paths";
import {
  existsDir,
  createFileScanner,
  ensureEmptyDir,
  fastFolderSizeAsync,
  isEmptyDir,
  isNotFoundError,
  mkdirIfNotExists,
  parsePackageFile,
  readDir,
  createWriteStreamPool,
} from "../utils/fs";
import { checkMatch, checkPath, makePathPatterns } from "../utils/string";
import { listTar, extractTar, createTar, CompressOptions } from "../utils/tar";
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
import { mkdir, readFile, writeFile, rm, cp } from "fs/promises";
import type { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { basename, dirname, join, resolve } from "path";

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
  compress?: boolean | CompressOptions;
};

type PackObject = {
  name?: string;
  compress?: boolean | CompressOptions;
  include: string[];
  exclude?: string[];
  onePackByResult?: boolean;
};

export type DatatruckPackageRepositoryConfigType = {
  compress?: boolean | CompressOptions;
  packs?: PackObject[];
};

export const datatruckRepositoryName = "datatruck";

export const datatruckRepositoryDefinition: JSONSchema7 = {
  type: "object",
  required: ["outPath"],
  additionalProperties: false,
  properties: {
    outPath: { type: "string" },
    compress: {
      anyOf: [{ type: "boolean" }, makeRef(DefinitionEnum.compressUtil)],
    },
  },
};

export const datatruckPackageRepositoryDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    compress: {
      anyOf: [{ type: "boolean" }, makeRef(DefinitionEnum.compressUtil)],
    },
    packs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["include"],
        properties: {
          name: { type: "string" },
          compress: {
            anyOf: [{ type: "boolean" }, makeRef(DefinitionEnum.compressUtil)],
          },
          include: makeRef(DefinitionEnum.stringListUtil),
          exclude: makeRef(DefinitionEnum.stringListUtil),
          onePackByResult: { type: "boolean" },
        },
      },
    },
  },
};

export class DatatruckRepository extends RepositoryAbstract<DatatruckRepositoryConfigType> {
  static zipBasenameTpl = `.*.dd.tar.gz`;

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
    if (await existsDir(snapshotPath))
      await rm(snapshotPath, {
        recursive: true,
      });
  }

  override async onSnapshots(data: SnapshotsDataType) {
    if (!(await existsDir(this.config.outPath)))
      throw new Error(
        `Repository (${this.repository.name}) out path does not exist: ${this.config.outPath}`,
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
          snapshotNameData.snapshotShortId.startsWith(id.slice(0, 8)),
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

  override async onBackup(
    data: BackupDataType<DatatruckPackageRepositoryConfigType>,
  ) {
    const snapshotName = DatatruckRepository.buildSnapshotName({
      snapshotId: data.snapshot.id,
      snapshotDate: data.snapshot.date,
      packageName: data.package.name,
    });
    const outPath = resolve(join(this.config.outPath, snapshotName));
    const pkg = data.package;
    const sourcePath = data.targetPath ?? pkg.path;

    ok(sourcePath);

    await mkdir(outPath, { recursive: true });

    const scanner = await createFileScanner({
      onProgress: data.onProgress,
      glob: {
        cwd: sourcePath,
        onlyFiles: false,
        include: await parsePaths(pkg.include ?? ["**"], {
          cwd: sourcePath,
          verbose: data.options.verbose,
        }),
        ignore: pkg.exclude
          ? await parsePaths(pkg.exclude, {
              cwd: sourcePath,
              verbose: data.options.verbose,
            })
          : undefined,
      },
    });

    const configPacks: PackObject[] = (data.packageConfig?.packs ?? []).map(
      (p) => ({
        ...p,
        compress:
          p.compress ?? data.packageConfig?.compress ?? this.config.compress,
      }),
    );

    const defaultsPack: PackObject = {
      name: "defaults",
      compress: data.packageConfig?.compress ?? this.config.compress,
      include: [],
    };

    const packs: PackObject[] = [...configPacks, defaultsPack];
    const defaultsPackIndex = packs.findIndex((p) => p === defaultsPack);
    const stream = createWriteStreamPool({
      path: await this.mkTmpDir("files"),
      onStreamPath: (key) => `files-${key}.txt`,
    });

    await scanner.start(async (entry) => {
      if (
        entry.dirent.isDirectory() &&
        !(await isEmptyDir(join(sourcePath, entry.path)))
      )
        return false;

      let packIndex = configPacks.findIndex((pack) =>
        checkPath(entry.path, pack.include, pack.exclude),
      );

      if (packIndex === -1) packIndex = defaultsPackIndex;

      const pack = packs[packIndex];

      if (pack.onePackByResult) {
        const subname = basename(entry.path);
        packs.push({
          ...pack,
          name: pack.name ? `${pack.name}-${subname}` : subname,
        });
        packIndex = packs.length - 1;
      }
      stream.writeLine(packIndex, entry.path);
      return true;
    });

    await stream.end();

    let packIndex = 0;

    for (const pack of packs) {
      const packBasename = [`pack`, packIndex.toString(), pack.name]
        .filter((v) => typeof v === "string")
        .map((v) => encodeURIComponent(v!.toString().replace(/[\\/]/g, "-")))
        .join("-");

      const ext = pack.compress ? `.tar.gz` : `.tar`;
      const includeList = stream.path(packIndex);

      if (includeList)
        await createTar({
          compress: pack.compress,
          verbose: data.options.verbose,
          includeList,
          path: sourcePath,
          output: join(outPath, packBasename) + ext,
          onEntry: async (data) =>
            await scanner.progress(
              pack.compress ? "Compressing" : "Packing",
              data.path,
            ),
        });
      packIndex++;
    }

    await scanner.end();

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
    data: CopyBackupType<DatatruckRepositoryConfigType>,
  ): Promise<void> {
    const snapshotName = DatatruckRepository.buildSnapshotName({
      snapshotId: data.snapshot.id,
      snapshotDate: data.snapshot.date,
      packageName: data.package.name,
    });
    const sourcePath = resolve(join(this.config.outPath, snapshotName));
    const targetPath = resolve(
      join(data.mirrorRepositoryConfig.outPath, snapshotName),
    );

    if (data.options.verbose) logExec(`Copying backup files to ${targetPath}`);

    await mkdir(targetPath, { recursive: true });
    await ensureEmptyDir(targetPath);

    const scanner = await createFileScanner({
      onProgress: data.onProgress,
      glob: {
        include: ["**/*"],
        cwd: sourcePath,
      },
    });

    const entryPaths: string[] = [];

    await scanner.start(async (entry) => {
      entryPaths.push(entry.path);
      return true;
    });

    for (const entryPath of entryPaths) {
      const sourceFile = join(sourcePath, entryPath);
      const targetFile = join(targetPath, entryPath);
      await scanner.progress("Copying", entryPath);
      await mkdir(dirname(targetFile), { recursive: true });
      await cp(sourceFile, targetFile);
    }

    await scanner.end();
  }

  override async onRestore(
    data: RestoreDataType<DatatruckPackageRepositoryConfigType>,
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
      onProgress: data.onProgress,
      glob: {
        cwd: sourcePath,
        include: ["**/*"],
      },
    });

    const tarFiles: string[] = [];

    await scanner.start(async (entry) => {
      const path = join(sourcePath, entry.name);
      const isTar = entry.name.endsWith(".tar");
      const isTarGz = entry.name.endsWith(".tar.gz");
      if (isTar || isTarGz) {
        tarFiles.push(path);
        await listTar({
          input: path,
          verbose: data.options.verbose,
          onEntry: () => {
            scanner.total++;
          },
        });
      }
      return false;
    });

    if (data.options.verbose) logExec(`Unpacking files to ${restorePath}`);

    for (const tarFile of tarFiles) {
      await extractTar({
        input: tarFile,
        output: restorePath,
        decompress: tarFile.endsWith(".tar.gz"),
        verbose: data.options.verbose,
        onEntry: async (data) =>
          await scanner.progress(
            tarFile.endsWith(".tar.gz") ? "Extracting" : "Unpacking",
            data.path,
          ),
      });
    }

    await scanner.end();
  }
}
