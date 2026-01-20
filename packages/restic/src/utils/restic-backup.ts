import { checkDiskSpace } from "./fs.js";
import { Ntfy } from "./ntfy.js";
import { ResticRepository } from "@datatruck/cli/repositories/ResticRepository.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { duration } from "@datatruck/cli/utils/date.js";
import { isLocalDir } from "@datatruck/cli/utils/fs.js";
import { Restic } from "@datatruck/cli/utils/restic.js";

export type CommonResticBackupTags = {
  id: string;
  shortId: string;
  hostname: string;
  date: string;
  vendor: string;
  version: string;
};

export type ResticBackupTags = CommonResticBackupTags & {
  package: string;
  tags?: string[];
};

export type ResticBackupPackage = {
  name: string;
  tags?: string[];
  path: string;
  exclude?: string[];
};

export type ResticBackupStats = {
  files: number;
  bytes: number;
  diffBytes: number | undefined;
};

export type ResticOptions = {
  name: string;
  tags: CommonResticBackupTags;
  minFreeSpace?: string;
  connection: {
    password: string;
    uri: string;
  };
};

export class ResticBackup {
  readonly processes: {
    name: string;
    error?: Error;
    stats: ResticBackupStats;
  }[] = [];
  protected startTime: number;
  readonly restic: Restic;
  constructor(
    readonly options: ResticOptions,
    protected ntfy: Ntfy,
    protected log: boolean | undefined,
  ) {
    this.startTime = Date.now();
    this.restic = new Restic({
      env: {
        RESTIC_PASSWORD: options.connection.password,
        RESTIC_REPOSITORY: options.connection.uri,
      },
      log,
    });
  }

  async run(input: ResticBackupPackage | ResticBackupPackage[]) {
    const items = Array.isArray(input) ? input : [input];
    for (const item of items) {
      await this.runSingle(item);
    }
  }

  protected async runSingle(item: ResticBackupPackage) {
    const now = Date.now();
    let error: Error | undefined;
    const stats: ResticBackupStats = {
      bytes: 0,
      files: 0,
      diffBytes: undefined,
    };
    try {
      if (
        isLocalDir(this.options.connection.uri) &&
        !(await this.restic.checkRepository())
      )
        await this.restic.exec(["init"]);

      const targetPath = isLocalDir(this.options.connection.uri)
        ? this.options.connection.uri
        : undefined;

      stats.diffBytes = await checkDiskSpace({
        minFreeSpace: this.options.minFreeSpace,
        minFreeSpacePath: targetPath ?? process.cwd(),
        targetPath,
        rutine: () => {
          const tags: ResticBackupTags = {
            ...this.options.tags,
            package: item.name,
            tags: item.tags ?? [],
          };
          return this.restic.backup({
            tags: ResticRepository.createSnapshotTags(tags as any),
            paths: [item.path],
            exclude: item.exclude,
            onStream(data) {
              if (data.message_type === "summary") {
                stats.files = data.total_files_processed;
                stats.bytes = data.total_bytes_processed;
              }
            },
          });
        },
      });
    } catch (inError) {
      error = inError as Error;
    }

    this.processes.push({ name: item.name, error, stats });

    await this.ntfy.send(
      `Backup`,
      {
        "- Repository": this.options.name,
        "- Package": item.name,
        "- Size": formatBytes(stats.bytes),
        ...(stats.diffBytes !== undefined && {
          "- Size change":
            (stats.diffBytes > 0 ? "+" : "") + formatBytes(stats.diffBytes),
        }),
        "- Files": stats.files,
        "- Duration": duration(Date.now() - now),
        "- Error": error?.message,
      },
      error,
    );
  }
}
