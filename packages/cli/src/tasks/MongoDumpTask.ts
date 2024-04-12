import { AsyncProcess } from "../utils/async-process";
import {
  ResolveDatabaseNameParams,
  resolveDatabaseName,
} from "../utils/datatruck/config";
import { AppError } from "../utils/error";
import { ensureEmptyDir, mkdirIfNotExists } from "../utils/fs";
import { MongoUriObject, resolveMongoUri, toMongoUri } from "../utils/mongodb";
import { mkTmpDir } from "../utils/temp";
import {
  TaskBackupData,
  TaskRestoreData,
  TaskAbstract,
  TaskPrepareRestoreData,
} from "./TaskAbstract";
import { readdir, rename, rmdir } from "fs/promises";
import { MongoClient } from "mongodb";
import { join } from "path";

export type MongoDumpTaskConfig = {
  uri: string | MongoUriObject;
  command?: string;
  compress?: boolean;
  concurrency?: number;
  targetDatabase?: {
    name: string;
  };
};

export const mongodumpTaskName = "mongo-dump";

export class MongoDumpTask extends TaskAbstract<MongoDumpTaskConfig> {
  protected verbose?: boolean;
  private get command() {
    return this.config.command ?? "mongodump";
  }

  override async backup(data: TaskBackupData) {
    this.verbose = data.options.verbose;

    const snapshotPath =
      data.package.path ??
      (await mkTmpDir(mongodumpTaskName, "task", "backup", "snapshot"));

    await mkdirIfNotExists(snapshotPath);
    await ensureEmptyDir(snapshotPath);

    const config = await resolveMongoUri(this.config.uri);
    const p = new AsyncProcess(
      this.command,
      [
        ...(config.host ? ["/h", config.host] : []),
        ...(config.port ? [`/port:${config.port}`] : []),
        ...["/authenticationDatabase:admin"],
        ...["/d", config.database],
        ...(config.username ? ["/u", config.username] : []),
        ...(this.config.compress ? ["/gzip"] : []),
        ...(this.config.concurrency ? ["/j", this.config.concurrency] : []),
        "/o",
        snapshotPath,
      ],
      { $log: this.verbose },
    );

    p.stdin.writable.write(`${config.password ?? ""}\n`);

    await p.stderr.parseLines((line) => {
      data.onProgress({
        absolute: {
          description: line.slice(0, 255),
        },
      });
    });
    const tmpDir = join(snapshotPath, config.database);
    for (const file of await readdir(tmpDir))
      await rename(join(tmpDir, file), join(snapshotPath, file));
    await rmdir(tmpDir);
    return { snapshotPath };
  }
  override async prepareRestore(data: TaskPrepareRestoreData) {
    return {
      snapshotPath:
        data.package.restorePath ??
        (await mkTmpDir(mongodumpTaskName, "task", "restore", "snapshot")),
    };
  }
  override async restore(data: TaskRestoreData) {
    this.verbose = data.options.verbose;

    const config = await resolveMongoUri(this.config.uri);
    const uri = toMongoUri(config);
    const client = new MongoClient(`${uri}?authSource=admin`);

    const params: ResolveDatabaseNameParams = {
      packageName: data.package.name,
      snapshotId: data.options.id,
      snapshotDate: data.snapshot.date,
      action: "restore",
      database: undefined,
    };

    const database = {
      name: resolveDatabaseName(config.database, params),
    };

    if (this.config.targetDatabase && !data.options.initial)
      database.name = resolveDatabaseName(this.config.targetDatabase.name, {
        ...params,
        database: database.name,
      });

    const restoreCollections = (await readdir(data.snapshotPath))
      .filter((name) => name.endsWith(".bson"))
      .map((name) => name.replace(/\.bson$/, ""));

    const collections: string[] = (
      await client.db(database.name).collections()
    ).map((v) => v.collectionName);

    const duplicatedCollections = restoreCollections.filter((v) =>
      collections.includes(v),
    );

    if (duplicatedCollections.length)
      throw new AppError(
        `Target collections already exists: ${duplicatedCollections.join(", ")}`,
      );

    const p = new AsyncProcess(
      "mongorestore",
      [
        ...(config.host ? ["/h", config.host] : []),
        ...(config.port ? [`/port:${config.port}`] : []),
        ...["/authenticationDatabase:admin"],
        ...["/d", database.name],
        ...(config.username ? ["/u", config.username] : []),
        ...(this.config.compress ? ["/gzip"] : []),
        ...(this.config.concurrency ? ["/j", this.config.concurrency] : []),
        data.snapshotPath,
      ],
      { $log: this.verbose },
    );

    p.stdin.writable.write(`${config.password ?? ""}\n`);

    await p.waitForClose();
  }
}
