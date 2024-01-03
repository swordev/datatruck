import { fastFolderSizeAsync } from "./fs";
import { exec, ExecResult, ExecSettingsInterface, ProcessEnv } from "./process";
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

  async exec(
    args: string[],
    settings?: ExecSettingsInterface,
    options?: { cwd?: string },
  ) {
    return await exec(
      "restic",
      args,
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...this.options.env },
        cwd: options?.cwd,
      },
      {
        stderr: { toExitCode: true },
        log: this.options.log
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
        ...(settings ?? {}),
      },
    );
  }

  async checkRepository() {
    const result = await this.exec(["cat", "config"], {
      onExitCodeError: () => false,
    });
    return result.exitCode === 0;
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
    const result = await this.exec([
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
    return result.stdout;
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
    const result = await this.exec(
      [
        "snapshots",
        ...(options.tags?.flatMap((tag) => [`--tag`, tag]) ?? []),
        ...(options.json ? ["--json"] : []),
        ...(options.paths?.flatMap((path) => ["--path", path]) ?? []),
        ...(options.latest ? ["--latest", options.latest.toString()] : []),
        ...(options.snapshotIds || []),
      ],
      {
        stdout: { save: true },
      },
    );
    return JSON.parse(result.stdout);
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
  }): Promise<ExecResult> {
    const exec = async () =>
      await this.exec(
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
        {
          stderr: {
            toExitCode: true,
          },
          stdout: {
            ...(options.onStream && {
              onData: (data) => {
                for (const rawLine of data.split("\n")) {
                  const line = rawLine.trim();
                  if (line.startsWith("{") && line.endsWith("}")) {
                    let parsedLine: ResticBackupStream | undefined;
                    try {
                      parsedLine = JSON.parse(line);
                    } catch (error) {}
                    if (parsedLine) options.onStream?.(parsedLine);
                  }
                }
              },
            }),
          },
        },
        {
          cwd: options.cwd,
        },
      );

    try {
      return await exec();
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
    onStream?: (data: ResticBackupStream) => void
  }) {
    return await this.exec(["copy", "--json", options.id], {
      stderr: {
        toExitCode: true,
      },
      stdout: {
        ...(options.onStream && {
          onData: async (data) => {
            if (data.startsWith("{") && data.endsWith("}")) {
              await options.onStream?.(JSON.parse(data));
            }
          },
        }),
      },
    });
  }

  async restore(options: {
    id: string;
    target: string;
    /**
     * @default 30_000
     */
    progressInterval?: number | false;
    onStream?: (data: ResticBackupStream) => Promise<void>;
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
      const result = await this.exec(
        ["restore", "--json", options.id, "--target", options.target],
        {
          stderr: {
            toExitCode: true,
          },
          stdout: {
            ...(options.onStream && {
              onData: async (data) => {
                if (data.startsWith("{") && data.endsWith("}")) {
                  await options.onStream?.(JSON.parse(data));
                }
              },
            }),
          },
        },
      );

      if (snapshots.at(0)?.tags?.includes(emptySnapshotTag))
        await rm(join(options.target, `.${emptySnapshotTag}`));

      return result;
    } finally {
      clearTimeout(progressTimeout);
    }
  }
}
