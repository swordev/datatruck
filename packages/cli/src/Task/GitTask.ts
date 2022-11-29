import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../util/cli-util";
import {
  checkDir,
  checkFile,
  cpy,
  ensureEmptyDir,
  forEachFile,
  mkdirIfNotExists,
} from "../util/fs-util";
import { progressPercent } from "../util/math-util";
import { exec } from "../util/process-util";
import { BackupDataType, RestoreDataType, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { createWriteStream } from "fs";
import { copyFile, rm } from "fs/promises";
import { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { join } from "path";
import { createInterface } from "readline";

export type GitTaskConfigType = {
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

export const gitTaskDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    command: {
      type: "string",
    },
    includeModified: {
      anyOf: [
        {
          type: "boolean",
        },
        makeRef(DefinitionEnum.stringListUtil),
      ],
    },
    includeUntracked: {
      anyOf: [
        {
          type: "boolean",
        },
        makeRef(DefinitionEnum.stringListUtil),
      ],
    },
    includeIgnored: {
      anyOf: [
        {
          type: "boolean",
        },
        makeRef(DefinitionEnum.stringListUtil),
      ],
    },
    includeConfig: {
      type: "boolean",
    },
    fileCopyConcurrency: {
      type: "integer",
      minimum: 1,
    },
  },
};

export class GitTask extends TaskAbstract<GitTaskConfigType> {
  protected verbose?: boolean;
  private get command() {
    return this.config.command ?? "git";
  }
  override async onBeforeBackup() {
    return {
      targetPath: await this.mkTmpDir(GitTask.name),
    };
  }
  override async onBackup(data: BackupDataType) {
    this.verbose = data.options.verbose;
    const config = this.config;

    const path = data.package.path;
    const targetPath = data.targetPath;

    ok(typeof path === "string");
    ok(typeof targetPath === "string");

    // Bundle

    const bundlePath = join(targetPath, "repo.bundle");

    await data.onProgress({
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
      }
    );

    // Config

    if (this.config.includeConfig ?? true) {
      const configPath = join(targetPath, "repo.config");
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
      option.pathsPath = join(targetPath, `repo.${option.name}-paths.txt`);
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
          }
        );
      } finally {
        await new Promise((resolve) => stream.end(resolve));
        if (streamError) throw streamError;
      }
    }

    // Copy

    for (const option of lsFilesConfig) {
      if (!option.include) continue;

      const outPath = join(targetPath, `repo.${option.name}`);

      await mkdirIfNotExists(outPath);

      if (data.options.verbose)
        logExec(`Copying ${option.name} files to ${outPath}`);

      await cpy({
        input: {
          type: "pathList",
          path: option.pathsPath!,
          basePath: path,
        },
        targetPath: outPath,
        skipNotFoundError: true,
        concurrency: this.config.fileCopyConcurrency,
        onPath: async ({ entryPath }) => {
          currentFiles++;
          await data.onProgress({
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
  }

  override async onBeforeRestore() {
    return {
      targetPath: await this.mkTmpDir(GitTask.name),
    };
  }

  override async onRestore(data: RestoreDataType) {
    this.verbose = data.options.verbose;

    const restorePath = data.package.restorePath;
    const targetPath = data.targetPath;

    ok(typeof restorePath === "string");
    ok(typeof targetPath === "string");

    await mkdirIfNotExists(restorePath);
    await ensureEmptyDir(restorePath);

    // Stats

    let totalFiles = 0;
    let currentFiles = 0;

    await forEachFile(targetPath, () => totalFiles++, true);

    const incrementProgress = async (
      description?: string,
      item?: string,
      count = true
    ) => {
      await data.onProgress({
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

    const bundlePath = join(targetPath, "repo.bundle");

    await exec(
      this.command,
      ["clone", bundlePath, "."],
      {
        cwd: restorePath,
      },
      {
        log: this.verbose,
      }
    );

    await incrementProgress();

    // Config

    const configPath = join(targetPath, "repo.config");

    if (await checkFile(configPath)) {
      await copyFile(configPath, join(restorePath, ".git", "config"));
      await incrementProgress();
    }

    // ls-files

    for (const name of ["untracked", "modified", "ignored"]) {
      const sourcePath = join(targetPath, `repo.${name}`);
      if (await checkDir(sourcePath)) {
        if (data.options.verbose)
          logExec(`Copying ${name} files to ${restorePath}`);
        await cpy({
          input: {
            type: "glob",
            sourcePath,
          },
          targetPath: restorePath,
          concurrency: this.config.fileCopyConcurrency,
          onProgress: async (progress) =>
            await incrementProgress(
              progress.type === "end" ? "Files copied" : "Copying file",
              progress.path,
              !progress.type
            ),
        });
      }
    }
  }
}
