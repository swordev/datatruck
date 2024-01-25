import { AsyncProcess } from "../utils/async-process";
import { ensureEmptyDir, fetchData, mkdirIfNotExists } from "../utils/fs";
import { mkTmpDir } from "../utils/temp";
import { TaskBackupData, TaskRestoreData, TaskAbstract } from "./TaskAbstract";

export type MongoDumpTaskConfig = {
  command?: string;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string | { path: string };
  compress?: boolean;
  concurrency?: number;
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

    const p = new AsyncProcess(
      this.command,
      [
        ...(this.config.hostname ? ["/h", this.config.hostname] : []),
        ...(this.config.port ? ["/p", this.config.port] : []),
        ...(this.config.username ? ["/u", this.config.username] : []),
        ...(this.config.compress ? ["/gzip"] : []),
        ...(this.config.concurrency ? ["/j", this.config.concurrency] : []),
        "/o",
        snapshotPath,
      ],
      {
        $log: this.verbose,
      },
    );

    const password =
      this.config.password !== undefined
        ? (await fetchData(this.config.password, (p) => p.path)) ?? ""
        : "";

    p.stdin.writable.write(`${password}\n`);

    await p.stderr.parseLines((line) => {
      data.onProgress({
        absolute: {
          description: line.slice(0, 255),
        },
      });
    });

    return { snapshotPath };
  }

  override async restore(data: TaskRestoreData) {
    throw new Error("Not implemented");
  }
}
