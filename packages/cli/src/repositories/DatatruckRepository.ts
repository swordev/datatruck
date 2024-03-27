import { runParallel } from "../utils/async";
import { logExec } from "../utils/cli";
import { calcFileHash } from "../utils/crypto";
import { createFs } from "../utils/datatruck/client";
import { createPkgFilter, createTaskFilter } from "../utils/datatruck/config";
import { BackupPathsOptions, parseBackupPaths } from "../utils/datatruck/paths";
import { AppError } from "../utils/error";
import {
  createFileScanner,
  parsePackageFile,
  createWriteStreamPool,
  tryRm,
  createProgress,
} from "../utils/fs";
import { progressPercent } from "../utils/math";
import { ProgressStats } from "../utils/progress";
import { match } from "../utils/string";
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
  SnapshotTagObject,
} from "./RepositoryAbstract";
import { ok } from "assert";
import { rm, stat } from "fs/promises";
import { basename, join, resolve } from "path";

export type MetaData = Omit<SnapshotTagObject, "shortId" | "size"> & {
  size: number;
  tarStats?: Record<
    string,
    { files: number; size: number; checksum: string } | undefined
  >;
};

export type DatatruckRepositoryConfig = {
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

export type DatatruckPackageRepositoryConfig = {
  compress?: boolean | CompressOptions;
  packs?: PackObject[];
};

export const datatruckRepositoryName = "datatruck";

export class DatatruckRepository extends RepositoryAbstract<DatatruckRepositoryConfig> {
  static zipBasenameTpl = `.*.dd.tar.gz`;

  static createSnapshotName(
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

  static async parseMetaData(data: string): Promise<MetaData> {
    return JSON.parse(data.toString());
  }

  override getSource() {
    return this.config.backend;
  }

  override fetchDiskStats(config: DatatruckRepositoryConfig) {
    const fs = createFs(config.backend, this.verbose);
    return fs.fetchDiskStats(".");
  }

  override async init(data: RepoInitData) {
    const fs = createFs(this.config.backend, this.verbose);
    await fs.mkdir(".");
  }

  override async prune(data: RepoPruneData) {
    const fs = createFs(this.config.backend, this.verbose);
    const snapshotName = DatatruckRepository.createSnapshotName(data.snapshot, {
      name: data.snapshot.packageName,
    });

    if (data.options.verbose)
      logExec(`Deleting ${fs.resolvePath(snapshotName)}`);
    if (await fs.existsDir(snapshotName)) await fs.rmAll(snapshotName);
  }

  override async fetchSnapshots(data: RepoFetchSnapshotsData) {
    const fs = createFs(this.config.backend, this.verbose);
    if (!(await fs.existsDir(".")))
      throw new AppError(
        `Repository (${
          this.repository.name
        }) out path does not exist: ${fs.resolvePath(".")}`,
      );

    const snapshots: Snapshot[] = [];
    const snapshotNames = await fs.readdir(".");
    const filterPkg = createPkgFilter(data.options.packageNames);
    const filterTask = createTaskFilter(data.options.packageTaskNames);
    const filterId = (shortId: string) =>
      !data.options.ids ||
      data.options.ids.some((id) => shortId.startsWith(id.slice(0, 8)));
    const preSnapshots: { name: string; metaData?: string }[] = snapshotNames
      .filter((snapshotName) => {
        const data = DatatruckRepository.parseSnapshotName(snapshotName);
        return (
          data && filterPkg(data.packageName) && filterId(data.snapshotShortId)
        );
      })
      .map((name) => ({ name }));

    await runParallel({
      items: preSnapshots,
      concurrency: 5,
      async onItem({ item }) {
        item.metaData = await fs.readFileIfExists(`${item.name}/meta.json`);
      },
    });

    for (const { name, metaData } of preSnapshots) {
      const meta =
        !!metaData && (await DatatruckRepository.parseMetaData(metaData));

      if (!meta || !filterTask(meta.task)) continue;

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
        originalId: name,
        id: meta.id,
        date: meta.date,
        packageName: meta.package,
        packageTaskName: meta.task,
        tags: meta.tags,
        hostname: meta.hostname ?? "",
        size: meta.size || 0,
      });
    }

    return snapshots;
  }

  override async backup(
    data: RepoBackupData<DatatruckPackageRepositoryConfig>,
  ) {
    const fs = createFs(this.config.backend, this.verbose);
    const snapshotName = DatatruckRepository.createSnapshotName(
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
      let packIndex = packs.findIndex(
        (pack) =>
          pack !== defaultsPack &&
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
    const tarStats: NonNullable<MetaData["tarStats"]> = {};

    for (const pack of packs) {
      const packBasename =
        [`pack`, packIndex.toString(), pack.name]
          .filter((v) => typeof v === "string")
          .map((v) => encodeURIComponent(v!.toString().replace(/[\\/]/g, "-")))
          .join("-") + (pack.compress ? `.tar.gz` : `.tar`);

      const includeList = stream.path(packIndex);

      if (includeList) {
        const stats = (tarStats[packBasename] = {
          files: stream.lines(packIndex)!,
          size: 0,
          checksum: "",
        });
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
        stats.checksum = await calcFileHash(tarPath, "sha1");
        stats.size = (await stat(tarPath)).size;
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

    const size = Object.values(tarStats).reduce(
      (total, stat) => total + stat!.size,
      0,
    );
    const metaPath = `${snapshotName}/meta.json`;
    const nodePkg = parsePackageFile();
    const meta: MetaData = {
      id: data.snapshot.id,
      hostname: data.hostname,
      date: data.snapshot.date,
      tags: data.options.tags ?? [],
      package: data.package.name,
      task: data.package.task?.name,
      version: nodePkg.version,
      size,
      tarStats,
    };

    if (data.options.verbose)
      logExec(`Writing metadata into ${fs.resolvePath(metaPath)}`);
    await fs.writeFile(`${snapshotName}/meta.json`, JSON.stringify(meta));

    return {
      bytes: size,
    };
  }

  override async copy(data: RepoCopyData<DatatruckRepositoryConfig>) {
    const sourceFs = createFs(this.config.backend, this.verbose);
    const targetFs = createFs(
      data.mirrorRepositoryConfig.backend,
      this.verbose,
    );
    const snapshotName = DatatruckRepository.createSnapshotName(
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
    let bytes = 0;
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
        const downloaded = await sourceFs.download(
          sourceEntry,
          targetFs.resolvePath(targetEntry),
          {
            onProgress: (progress) =>
              data.onProgress({
                absolute,
                relative: {
                  description: "Downloading",
                  format: "size",
                  payload: entry,
                  ...progress,
                },
              }),
          },
        );
        bytes += downloaded.bytes;
      } else {
        const tempDir = await mkTmpDir(
          datatruckRepositoryName,
          "repo",
          "remote-copy",
          entry,
        );
        const tempFile = join(tempDir, entry);
        try {
          const downloaded = await sourceFs.download(sourceEntry, tempFile, {
            onProgress: (progress) =>
              data.onProgress({
                absolute,
                relative: {
                  description: "Downloading",
                  format: "size",
                  payload: entry,
                  ...progress,
                },
              }),
          });
          bytes += downloaded.bytes;
          await targetFs.upload(tempFile, targetEntry);
        } finally {
          await tryRm(tempFile);
        }
      }
    }

    await targetFs.rename(tmpSnapshotName, snapshotName);

    return { bytes };
  }

  override async restore(
    data: RepoRestoreData<DatatruckPackageRepositoryConfig>,
  ) {
    const fs = createFs(this.config.backend, this.verbose);
    const relRestorePath = data.snapshotPath;
    ok(relRestorePath);
    const restorePath = resolve(relRestorePath);
    const [snapshot] = await this.fetchSnapshots({
      options: {
        ids: [data.options.id],
      },
    });

    if (!snapshot) throw new AppError("Snapshot not found");

    const snapshotName = DatatruckRepository.createSnapshotName(
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
    for (const file in tarStats) progress.total += tarStats[file]!.files;
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
          await fs.download(sourceEntry, tempEntry, {
            onProgress: (stats) => {
              progress.updateRelative("Downloading", entry, {
                ...stats,
                format: "size",
              });
            },
          });
        }
        const stats = tarStats[entry];
        if (data.options.verbose)
          logExec(`Stats of '${entry}' is not available`);
        await extractTar({
          total: stats?.files,
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
