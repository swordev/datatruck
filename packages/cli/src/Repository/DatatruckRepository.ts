import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../utils/cli";
import { calcFileHash } from "../utils/crypto";
import { createFs } from "../utils/datatruck/client";
import { BackupPathsOptions, parseBackupPaths } from "../utils/datatruck/paths";
import {
  createFileScanner,
  parsePackageFile,
  createWriteStreamPool,
  tryRm,
  createProgress,
} from "../utils/fs";
import { progressPercent } from "../utils/math";
import { ProgressStats } from "../utils/progress";
import { checkMatch, match, makePathPatterns } from "../utils/string";
import {
  extractTar,
  createTar,
  CompressOptions,
  normalizeTarPath,
} from "../utils/tar";
import { mkTmpDir } from "../utils/temp";
import {
  RepositoryAbstract,
  RepoBackupData,
  RepoInitData,
  RepoRestoreData,
  RepoFetchSnapshotsData,
  Snapshot,
  RepoPruneData,
  RepoCopyData,
} from "./RepositoryAbstract";
import { ok } from "assert";
import { rm, stat } from "fs/promises";
import type { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { basename, join, resolve } from "path";

export type MetaDataType = {
  id: string;
  date: string;
  package: string;
  task: string | undefined;
  tags: string[];
  version: string;
  size: number;
  tarStats?: Record<string, { files: number; size: number; checksum: string }>;
};

export type DatatruckRepositoryConfigType = {
  backend: string;
  compress?: boolean | CompressOptions;
};

type PackObject = {
  name?: string;
  compress?: boolean | CompressOptions;
  include?: string[];
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
  required: ["backend"],
  additionalProperties: false,
  properties: {
    backend: { type: "string" },
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

  static buildSnapshotName(
    snapshot: { id: string; date: string },
    pkg: { name: string },
  ) {
    const date = snapshot.date.replace(/:/g, "-");
    const pkgName = encodeURIComponent(pkg.name)
      .replace(/%40/g, "@")
      .replace("_", "%5F");
    const snapshotShortId = snapshot.id.slice(0, 8);
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

  static async parseMetaData(data: string): Promise<MetaDataType> {
    return JSON.parse(data.toString());
  }

  override getSource() {
    return this.config.backend;
  }

  override fetchDiskStats(config: DatatruckRepositoryConfigType) {
    const fs = createFs(config.backend);
    return fs.fetchDiskStats(".");
  }

  override async init(data: RepoInitData) {
    const fs = createFs(this.config.backend);
    await fs.mkdir(".");
  }

  override async prune(data: RepoPruneData) {
    const fs = createFs(this.config.backend);
    const snapshotName = DatatruckRepository.buildSnapshotName(data.snapshot, {
      name: data.snapshot.packageName,
    });

    if (data.options.verbose)
      logExec(`Deleting ${fs.resolvePath(snapshotName)}`);
    if (await fs.existsDir(snapshotName)) await fs.rmAll(snapshotName);
  }

  override async fetchSnapshots(data: RepoFetchSnapshotsData) {
    const fs = createFs(this.config.backend);
    if (!(await fs.existsDir(".")))
      throw new Error(
        `Repository (${
          this.repository.name
        }) out path does not exist: ${fs.resolvePath(".")}`,
      );

    const snapshots: Snapshot[] = [];
    const snapshotNames = await fs.readdir(".");
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

      const metaData = await fs.readFileIfExists(`${snapshotName}/meta.json`);
      const meta =
        !!metaData && (await DatatruckRepository.parseMetaData(metaData));

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

  override async backup(
    data: RepoBackupData<DatatruckPackageRepositoryConfigType>,
  ) {
    const fs = createFs(this.config.backend);
    const snapshotName = DatatruckRepository.buildSnapshotName(
      data.snapshot,
      data.package,
    );
    const outPath = fs.isLocal()
      ? fs.resolvePath(snapshotName)
      : await mkTmpDir(datatruckRepositoryName, "repo", "backup", "fs-remote");
    const pkg = data.package;
    const path = pkg.path;

    await fs.mkdir(snapshotName);

    const backupPathsOptions: BackupPathsOptions = {
      package: data.package,
      snapshot: data.snapshot,
      path: path,
      verbose: data.options.verbose,
    };

    const scanner = await createFileScanner({
      onProgress: data.onProgress,
      glob: {
        cwd: path,
        onlyFiles: false,
        include: await parseBackupPaths(
          pkg.include ?? ["**"],
          backupPathsOptions,
        ),
        ignore: pkg.exclude
          ? await parseBackupPaths(pkg.exclude, backupPathsOptions)
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
    };

    const packs: PackObject[] = [defaultsPack, ...configPacks];
    const defaultsPackIndex = packs.findIndex((p) => p === defaultsPack);
    const stream = createWriteStreamPool({
      path: await mkTmpDir(
        datatruckRepositoryName,
        "repo",
        "backup",
        "stream-pool",
      ),
      onStreamPath: (key) => `files-${key}.txt`,
    });

    scanner.total++;
    stream.writeLine(defaultsPackIndex, ".");

    await scanner.start(async (entry) => {
      let packIndex = configPacks.findIndex((pack) =>
        match(entry.path, pack.include, pack.exclude),
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
      if (!stream.lines(packIndex)) {
        scanner.total++;
        stream.writeLine(packIndex, ".");
      }
      stream.writeLine(packIndex, normalizeTarPath(entry.path));
      return true;
    });

    await stream.end();

    let packIndex = 0;
    const tarStats: NonNullable<MetaDataType["tarStats"]> = {};

    for (const pack of packs) {
      const packBasename =
        [`pack`, packIndex.toString(), pack.name]
          .filter((v) => typeof v === "string")
          .map((v) => encodeURIComponent(v!.toString().replace(/[\\/]/g, "-")))
          .join("-") + (pack.compress ? `.tar.gz` : `.tar`);

      const includeList = stream.path(packIndex);

      if (includeList) {
        tarStats[packBasename] = {
          files: stream.lines(packIndex)!,
          size: 0,
          checksum: "",
        };
        const tarPath = join(outPath, packBasename);

        await createTar({
          compress: pack.compress,
          verbose: data.options.verbose,
          includeList,
          path: path,
          output: tarPath,
          onEntry: async (data) =>
            scanner.progress(
              pack.compress ? "Compressing" : "Packing",
              data.path,
            ),
        });

        scanner.progress("Fetching tar stats", basename(tarPath), false);
        tarStats[packBasename].checksum = await calcFileHash(tarPath, "sha1");
        tarStats[packBasename].size = (await stat(tarPath)).size;
        if (!fs.isLocal()) {
          scanner.progress("Uploading tar", basename(tarPath), false);
          await fs.upload(tarPath, `${snapshotName}/${packBasename}`);
          await rm(tarPath);
        }
      }
      packIndex++;
    }

    scanner.end();

    // Meta

    const metaPath = `${snapshotName}/meta.json`;
    const nodePkg = parsePackageFile();
    const meta: MetaDataType = {
      id: data.snapshot.id,
      date: data.snapshot.date,
      tags: data.options.tags ?? [],
      package: data.package.name,
      task: data.package.task?.name,
      version: nodePkg.version,
      size: Object.values(tarStats).reduce(
        (total, { size }) => total + size,
        0,
      ),
      tarStats,
    };
    if (data.options.verbose)
      logExec(`Writing metadata into ${fs.resolvePath(metaPath)}`);
    await fs.writeFile(`${snapshotName}/meta.json`, JSON.stringify(meta));
  }

  override async copy(
    data: RepoCopyData<DatatruckRepositoryConfigType>,
  ): Promise<void> {
    const sourceFs = createFs(this.config.backend);
    const targetFs = createFs(data.mirrorRepositoryConfig.backend);
    const snapshotName = DatatruckRepository.buildSnapshotName(
      data.snapshot,
      data.package,
    );

    if (data.options.verbose)
      logExec(`Copying backup files to ${data.mirrorRepositoryConfig.backend}`);

    const tmpSnapshotName = `${snapshotName}_tmp`;

    if (await targetFs.existsDir(snapshotName))
      await targetFs.ensureEmptyDir(snapshotName);

    try {
      await targetFs.rmAll(tmpSnapshotName);
    } catch (_) {}

    await targetFs.mkdir(tmpSnapshotName);
    await targetFs.ensureEmptyDir(tmpSnapshotName);

    const entries = await sourceFs.readdir(snapshotName);

    const total = entries.length;

    let current = 0;
    for (const entry of entries) {
      const absolute: ProgressStats = {
        current,
        description: "Copying",
        payload: entry,
        total,
        percent: progressPercent(total, current),
      };
      data.onProgress({ absolute });
      current++;
      const sourceEntry = `${snapshotName}/${entry}`;
      const targetEntry = `${tmpSnapshotName}/${entry}`;
      if (targetFs.isLocal()) {
        await sourceFs.download(
          sourceEntry,
          targetFs.resolvePath(targetEntry),
          {
            onProgress: (progress) =>
              data.onProgress({
                absolute,
                relative: {
                  description: "Downloading",
                  format: "size",
                  ...progress,
                },
              }),
          },
        );
      } else {
        const tempDir = await mkTmpDir(
          datatruckRepositoryName,
          "repo",
          "remote-copy",
          entry,
        );
        const tempFile = join(tempDir, entry);
        try {
          await sourceFs.download(sourceEntry, tempFile, {
            onProgress: (progress) =>
              data.onProgress({
                absolute,
                relative: {
                  description: "Downloading",
                  format: "size",
                  ...progress,
                },
              }),
          });
          await targetFs.upload(tempFile, targetEntry);
        } finally {
          await tryRm(tempFile);
        }
      }
    }

    await targetFs.rename(tmpSnapshotName, snapshotName);
  }

  override async restore(
    data: RepoRestoreData<DatatruckPackageRepositoryConfigType>,
  ) {
    const fs = createFs(this.config.backend);
    const relRestorePath = data.snapshotPath;
    ok(relRestorePath);
    const restorePath = resolve(relRestorePath);
    const [snapshot] = await this.fetchSnapshots({
      options: {
        ids: [data.options.snapshotId],
      },
    });

    if (!snapshot) throw new AppError("Snapshot not found");

    const snapshotName = DatatruckRepository.buildSnapshotName(
      snapshot,
      data.package,
    );
    const meta = await DatatruckRepository.parseMetaData(
      await fs.readFile(`${snapshotName}/meta.json`),
    );

    const progress = createProgress({ onProgress: data.onProgress });

    progress.update("Scanning files");
    const entries = (await fs.readdir(snapshotName)).filter(
      (v) => v.endsWith(".tar") || v.endsWith(".tar.gz"),
    );
    const tarStats = meta?.tarStats || {};
    for (const file in tarStats) progress.total += tarStats[file].files;
    progress.update(`Scanned files: ${progress.total}`);

    if (data.options.verbose) logExec(`Unpacking files to ${restorePath}`);

    for (const entry of entries) {
      let tempEntry: string | undefined;
      try {
        const sourceEntry = `${snapshotName}/${entry}`;
        if (!fs.isLocal()) {
          const tempDir = await mkTmpDir(
            datatruckRepositoryName,
            "repo",
            "restore",
            "remote-fs",
            entry,
          );
          tempEntry = `${tempDir}/${entry}`;
          await fs.download(sourceEntry, tempEntry);
        }
        await extractTar({
          total: tarStats[entry].files,
          input: tempEntry ?? fs.resolvePath(sourceEntry),
          output: restorePath,
          decompress: entry.endsWith(".tar.gz"),
          verbose: data.options.verbose,
          onEntry: (data) =>
            progress.update(
              entry.endsWith(".tar.gz") ? "Extracting" : "Unpacking",
              data.path,
            ),
        });
      } finally {
        if (tempEntry) await tryRm(tempEntry);
      }
    }

    progress.update("Finished");
  }
}
