import { mkTmpDir } from "./fs-util";
import { exec, ExecResultType, ExecSettingsInterface } from "./process-util";
import { formatUri, UriType } from "./string-util";
import { writeFile, readFile } from "fs/promises";
import { resolve } from "path";

export type RepositoryType = {
  name?: string;
  env?: Record<string, string>;
  passwordFile?: string;
  backend: "local" | "rest" | "sftp" | "s3" | "azure" | "gs" | "rclone";
} & UriType;

export type BackupStreamType =
  | {
      message_type: "status";
      seconds_elapsed: number;
      percent_done: number;
      total_files: number;
      files_done?: number;
      total_bytes: number;
      bytes_done?: number;
      current_files?: string[];
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

export class ResticUtil {
  constructor(
    readonly options: {
      log?: boolean;
      env: Record<string, string>;
    }
  ) {}

  static async formatRepository(input: RepositoryType, hidePassword?: boolean) {
    if (input.backend === "local") {
      if (typeof input.path !== "string")
        throw new Error(
          `Invalid path at "${input.name}" repository: ${input.path}`
        );
      return resolve(input.path);
    }

    if (input.passwordFile)
      input = {
        ...input,
        password: (await readFile(input.passwordFile)).toString(),
      };

    return `${input.backend}:${formatUri(input, hidePassword)}`;
  }

  async exec(
    args: string[],
    settings?: ExecSettingsInterface,
    options?: { cwd?: string }
  ) {
    return await exec(
      "restic",
      args,
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...this.options.env },
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
              envNames: ["RESTIC_REPOSITORY", "RESTIC_PASSWORD_FILE"],
            }
          : {},
        ...(settings ?? {}),
      }
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
      ],
      {
        stdout: { save: true },
      }
    );
    return JSON.parse(result.stdout);
  }

  async checkBackupSetPathSupport() {
    const result = await this.exec(["backup", "--set-path"], {
      onExitCodeError: () => false,
      stderr: { save: true },
    });
    return result.stderr.includes("flag needs an argument");
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
    onStream?: (data: BackupStreamType) => void;
  }): Promise<ExecResultType> {
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
                    let parsedLine: BackupStreamType | undefined;
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
        }
      );

    try {
      return await exec();
    } catch (error) {
      if (
        options.allowEmptySnapshot &&
        (error as NodeJS.ErrnoException).message.includes(
          "unable to save snapshot: snapshot is empty"
        )
      ) {
        const emptyPath = await mkTmpDir("empty");
        await writeFile(`${emptyPath}/.empty`, "");
        return await this.backup({
          ...options,
          cwd: emptyPath,
          allowEmptySnapshot: false,
          paths: ["."],
          exclude: [],
          excludeFile: [],
        });
      }
      throw error;
    }
  }

  async restore(options: {
    id: string;
    target: string;
    onStream?: (data: BackupStreamType) => Promise<void>;
  }) {
    return await this.exec(
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
      }
    );
  }
}
