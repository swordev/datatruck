import { logExec } from "../utils/cli";
import {
  existsDir,
  existsFile,
  cpy,
  forEachFile,
  mkdirIfNotExists,
  initEmptyDir,
} from "../utils/fs";
import { progressPercent } from "../utils/math";
import { exec } from "../utils/process";
import { mkTmpDir } from "../utils/temp";
import { TaskBackupData, TaskRestoreData, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { createWriteStream } from "fs";
import { copyFile, rm } from "fs/promises";
import { isMatch } from "micromatch";
import { join } from "path";
import { createInterface } from "readline";

export type GitTaskConfig = {
  command?: string;
  /**
   * @default true
   */
  includeModified?: boolean | string[];
  /**
   * @default true
   */
  includeUntracked?: boolean | string[];
  /**
   * @default false
   */
  includeIgnored?: boolean | string[];
  /**
   * @default true
   */
  includeConfig?: boolean;
  /**
   * @default 1
   */
  fileCopyConcurrency?: number;
};

export const gitTaskName = "git";

export class GitTask extends TaskAbstract<GitTaskConfig> {
  protected verbose?: boolean;
  private get command() {
    return this.config.command ?? "git";
  }

  override async backup(data: TaskBackupData) {
    if (!data.package.path) throw new Error(`Path is required`);
    const snapshotPath = await mkTmpDir(
      gitTaskName,
      "task",
      "backup",
      "snapshot",
    );
    this.verbose = data.options.verbose;
    const config = this.config;

    const path = data.package.path;

    ok(typeof path === "string");

    // Bundle

    const bundlePath = join(snapshotPath, "repo.bundle");

    data.onProgress({
      relative: {
        description: "Creating bundle",
      },
    });

    await exec(
      this.command,
      ["bundle", "create", bundlePath, "--all"],
      {
        cwd: path,
      },
      {
        log: this.verbose,
      },
    );

    // Config

    if (this.config.includeConfig ?? true) {
      const configPath = join(snapshotPath, "repo.config");
      await copyFile(join(path, ".git", "config"), configPath);
    }

    // git ls-files

    const lsFilesConfig: {
      argv: string[];
      name: string;
      include?: boolean | string[];
      pathsPath?: string;
    }[] = [
      {
        name: "untracked",
        argv: ["--others"],
        include: config.includeUntracked ?? true,
      },
      {
        name: "modified",
        argv: ["--modified"],
        include: config.includeModified ?? true,
      },
      {
        name: "ignored",
        argv: ["--others", "--ignored"],
        include: config.includeIgnored,
      },
    ];

    // Paths list

    let total = 0;
    let currentFiles = 0;

    for (const option of lsFilesConfig) {
      if (!option.include) continue;
      option.pathsPath = join(snapshotPath, `repo.${option.name}-paths.txt`);
      const stream = createWriteStream(option.pathsPath);
      let streamError: Error | undefined;
      stream.on("error", (e) => (streamError = e));
      try {
        await exec(
          this.command,
          [
            "-c",
            "core.quotepath=off",
            "ls-files",
            ...option.argv,
            "--exclude-standard",
          ],
          {
            cwd: data.package.path,
          },
          {
            log: {
              exec: this.verbose,
            },
            onSpawn: (p) => {
              const iface = createInterface(p.stdout!, stream);
              iface.on("close", () => stream.end());
              iface.on("line", (path) => {
                path = path.trim();
                if (!path.length) return;
                let found = false;
                if (option.include === true) {
                  found = true;
                } else if (option.include) {
                  found = isMatch(path, option.include);
                }
                if (found) {
                  total++;
                  stream.write(`${path}\n`);
                }
              });
            },
          },
        );
      } finally {
        await new Promise((resolve) => stream.end(resolve));
        if (streamError) throw streamError;
      }
    }

    // Copy

    for (const option of lsFilesConfig) {
      if (!option.include) continue;

      const outPath = join(snapshotPath, `repo.${option.name}`);

      await mkdirIfNotExists(outPath);

      if (data.options.verbose)
        logExec(`Copying ${option.name} files to ${outPath}`);

      await cpy({
        input: {
          type: "pathList",
          path: option.pathsPath!,
          basePath: path,
        },
        outPath: outPath,
        skipNotFoundError: true,
        concurrency: this.config.fileCopyConcurrency,
        onPath: async ({ entryPath }) => {
          currentFiles++;
          data.onProgress({
            relative: {
              description: "Copying file",
              payload: entryPath,
            },
            absolute: {
              total,
              current: currentFiles,
              percent: progressPercent(total, currentFiles),
            },
          });
        },
      });

      await rm(option.pathsPath!);
    }
    return { snapshotPath };
  }

  override async prepareRestore() {
    return {
      snapshotPath: await mkTmpDir(gitTaskName, "task", "restore", "snapshot"),
    };
  }

  override async restore(data: TaskRestoreData) {
    this.verbose = data.options.verbose;

    const snapshotPath = data.snapshotPath;
    const restorePath = await initEmptyDir(
      data.package.restorePath ?? data.package.path,
    );

    // Stats

    let totalFiles = 0;
    let currentFiles = 0;

    await forEachFile(snapshotPath, () => totalFiles++, true);

    const incrementProgress = async (
      description?: string,
      item?: string,
      count = true,
    ) => {
      data.onProgress({
        absolute: {
          total: totalFiles,
          current: Math.max(currentFiles, 0),
          percent: progressPercent(totalFiles, Math.max(currentFiles, 0)),
        },
        relative: { description, payload: item },
      });
      if (count) currentFiles++;
    };

    // Bundle

    const bundlePath = join(snapshotPath, "repo.bundle");

    await exec(
      this.command,
      ["clone", bundlePath, "."],
      {
        cwd: restorePath,
      },
      {
        log: this.verbose,
      },
    );

    await incrementProgress();

    // Config

    const configPath = join(snapshotPath, "repo.config");

    if (await existsFile(configPath)) {
      await copyFile(configPath, join(restorePath, ".git", "config"));
      await incrementProgress();
    }

    // ls-files

    for (const name of ["untracked", "modified", "ignored"]) {
      const sourcePath = join(snapshotPath, `repo.${name}`);
      if (await existsDir(sourcePath)) {
        if (data.options.verbose)
          logExec(`Copying ${name} files to ${restorePath}`);
        await cpy({
          input: {
            type: "glob",
            sourcePath,
          },
          outPath: restorePath,
          concurrency: this.config.fileCopyConcurrency,
          onProgress: async (progress) =>
            await incrementProgress(
              progress.type === "end" ? "Files copied" : "Copying file",
              progress.path,
              !progress.type,
            ),
        });
      }
    }
  }
}
