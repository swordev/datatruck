import { AsyncProcess, AsyncProcessOptions } from "./async-process";
import { fastFolderSizeAsync } from "./fs";
import { ProcessEnv } from "./process";
import { formatUri, Uri } from "./string";
import { writeFile, readFile, rm } from "fs/promises";
import { join, resolve } from "path";

const emptySnapshotTag = "empty-snapshot";

export type ResticRepositoryUri = {
  name?: string;
  env?: ProcessEnv;
  password?: string | { path: string };
  backend: "local" | "rest" | "sftp" | "s3" | "azure" | "gs" | "rclone";
} & Omit<Uri, "password">;

export type ResticBackupStream =
  | {
      message_type: "status";
      seconds_elapsed?: number;
      percent_done: number;
      total_files?: number;
      files_done?: number;
      total_bytes: number;
      bytes_done?: number;
      current_files?: string[];
    }
  | {
      message_type: "restore-status";
      total_bytes: number;
    }
  | {
      message_type: "summary";
      files_new: number;
      files_changed: number;
      files_unmodified: number;
      dirs_new: number;
      dirs_changed: number;
      dirs_unmodified: number;
      data_blobs: number;
      tree_blobs: number;
      data_added: number;
      total_files_processed: number;
      total_bytes_processed: number;
      total_duration: number;
      snapshot_id: string;
    };

export class Restic {
  constructor(
    readonly options: {
      log?: boolean;
      env: Record<string, string>;
    },
  ) {}

  static async formatRepository(
    input: ResticRepositoryUri,
    hidePassword?: boolean,
  ) {
    if (input.backend === "local") {
      if (typeof input.path !== "string")
        throw new Error(
          `Invalid path at "${input.name}" repository: ${input.path}`,
        );
      return resolve(input.path);
    }

    if (input.password) {
      input = {
        ...input,
        password:
          typeof input.password === "string"
            ? input.password
            : (await readFile(input.password.path)).toString(),
      };
    }

    return `${input.backend}:${formatUri(
      { ...input, password: input.password as string },
      hidePassword,
    )}`;
  }

  private createProcess(args: string[], options?: AsyncProcessOptions) {
    return new AsyncProcess("restic", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...this.options.env },
      $log: this.options.log
        ? {
            exec: true,
            stdout: true,
            stderr: true,
            colorize: true,
            allToStderr: true,
            envNames: [
              "RESTIC_REPOSITORY",
              "RESTIC_PASSWORD_FILE",
              "RESTIC_PASSWORD",
            ],
          }
        : {},
      ...(options ?? {}),
    });
  }

  async exec(args: string[], options?: AsyncProcessOptions) {
    return await this.createProcess(args, options).waitForClose();
  }
  private async stdout(args: string[], options?: AsyncProcessOptions) {
    return await this.createProcess(args, options).stdout.fetch();
  }
  async checkRepository() {
    return (
      (await this.exec(["cat", "config"], {
        $exitCode: false,
      })) === 0
    );
  }

  async forget(options: {
    snapshotId?: string;
    keepLast?: number;
    keepHourly?: number;
    keepDaily?: number;
    keepWeekly?: number;
    keepMonthly?: number;
    keepYearly?: number;
    keepWithin?: string;
    keepTag?: string[];
    tag?: string[];
    prune?: boolean;
  }) {
    await this.exec([
      "forget",
      ...(options.keepLast ? ["--keep-last", options.keepLast.toString()] : []),
      ...(options.keepHourly
        ? ["--keep-hourly", options.keepHourly.toString()]
        : []),
      ...(options.keepDaily
        ? ["--keep-daily", options.keepDaily.toString()]
        : []),
      ...(options.keepWeekly
        ? ["--keep-weekly", options.keepWeekly.toString()]
        : []),
      ...(options.keepMonthly
        ? ["--keep-monthly", options.keepMonthly.toString()]
        : []),
      ...(options.keepYearly
        ? ["--keep-yearly", options.keepYearly.toString()]
        : []),
      ...(options.keepWithin
        ? ["--keep-within", options.keepWithin.toString()]
        : []),
      ...(options.keepTag
        ? options.keepTag.flatMap((v) => ["--keepTag", v])
        : []),
      ...(options.tag ? options.tag.flatMap((v) => ["--tag", v]) : []),
      ...(options.prune ? ["--prune"] : []),
      ...(options.snapshotId ? [options.snapshotId] : []),
    ]);
  }

  async snapshots(options: {
    tags?: string[];
    paths?: string[];
    latest?: number;
    json?: boolean;
    snapshotIds?: string[];
  }): Promise<
    {
      time: string;
      tree: string;
      paths: string[];
      tags?: string[];
      hostname: string;
      username: string;
      excludes: string[];
      id: string;
      short_id: string;
    }[]
  > {
    const json = await this.stdout([
      "snapshots",
      ...(options.tags?.flatMap((tag) => [`--tag`, tag]) ?? []),
      ...(options.json ? ["--json"] : []),
      ...(options.paths?.flatMap((path) => ["--path", path]) ?? []),
      ...(options.latest ? ["--latest", options.latest.toString()] : []),
      ...(options.snapshotIds || []),
    ]);
    return JSON.parse(json);
  }

  async backup(options: {
    cwd?: string;
    tags?: string[];
    paths: string[];
    setPaths?: string[];
    exclude?: string[];
    excludeFile?: string[];
    parent?: string;
    allowEmptySnapshot?: boolean;
    onStream?: (data: ResticBackupStream) => void;
    createEmptyDir?: () => Promise<string>;
  }): Promise<void> {
    try {
      const backup = this.createProcess(
        [
          "backup",
          "--json",
          ...(options.exclude?.flatMap((v) => ["-e", v]) ?? []),
          ...(options.excludeFile?.flatMap((v) => ["--exclude-file", v]) ?? []),
          ...(options.tags?.flatMap((v) => ["--tag", v]) ?? []),
          ...(options.setPaths?.flatMap((v) => ["--set-path", v]) ?? []),
          ...(options.parent ? ["--parent", options.parent] : []),
          ...options.paths,
        ],
        { cwd: options.cwd },
      );

      if (options.onStream) {
        await backup.stdout.parseLines((line) => {
          if (line.startsWith("{") && line.endsWith("}")) {
            let parsedLine: ResticBackupStream | undefined;
            try {
              parsedLine = JSON.parse(line);
            } catch (error) {}
            if (parsedLine) options.onStream?.(parsedLine);
          }
        });
      } else {
        await backup.waitForClose();
      }
    } catch (error) {
      if (
        options.allowEmptySnapshot &&
        (error as NodeJS.ErrnoException).message.includes(
          "unable to save snapshot: snapshot is empty",
        )
      ) {
        if (options.createEmptyDir) {
          const emptyPath = await options.createEmptyDir();
          await writeFile(`${emptyPath}/.${emptySnapshotTag}`, "");
          return await this.backup({
            ...options,
            tags: [...(options.tags || []), emptySnapshotTag],
            cwd: emptyPath,
            allowEmptySnapshot: false,
            paths: ["."],
            exclude: [],
            excludeFile: [],
          });
        }
      }
      throw error;
    }
  }

  async copy(options: {
    id: string;
    onStream?: (data: ResticBackupStream) => void;
  }) {
    const copy = this.createProcess(["copy", "--json", options.id]);
    if (options.onStream) {
      await copy.stdout.parseLines((line) => {
        if (line.startsWith("{") && line.endsWith("}")) {
          options.onStream?.(JSON.parse(line));
        }
      });
    } else {
      await copy.waitForClose();
    }
  }

  async restore(options: {
    id: string;
    target: string;
    /**
     * @default 30_000
     */
    progressInterval?: number | false;
    onStream?: (data: ResticBackupStream) => void;
  }) {
    let progressTimeout: NodeJS.Timeout | undefined;
    const progressInterval = options.progressInterval ?? 30_000;

    async function progressRutine() {
      try {
        const total_bytes = await fastFolderSizeAsync(options.target);
        options.onStream?.({
          message_type: "restore-status",
          total_bytes,
        });
      } finally {
        if (typeof progressInterval === "number")
          progressTimeout = setTimeout(progressRutine, progressInterval);
      }
    }

    const snapshots = await this.snapshots({
      snapshotIds: [options.id],
      json: true,
    });

    if (typeof progressInterval === "number") progressRutine();

    try {
      const result = this.createProcess([
        "restore",
        "--json",
        options.id,
        "--target",
        options.target,
      ]);

      if (options.onStream) {
        await result.stdout.parseLines((line) => {
          if (line.startsWith("{") && line.endsWith("}")) {
            options.onStream?.(JSON.parse(line));
          }
        });
      } else {
        await result.waitForClose();
      }

      if (snapshots.at(0)?.tags?.includes(emptySnapshotTag))
        await rm(join(options.target, `.${emptySnapshotTag}`));

      return result;
    } finally {
      clearTimeout(progressTimeout);
    }
  }
}
