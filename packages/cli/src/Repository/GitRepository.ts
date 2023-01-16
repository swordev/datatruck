import { AppError } from "../Error/AppError";
import { Git } from "../utils/Git";
import { logExec } from "../utils/cli";
import { parsePaths } from "../utils/datatruck/paths";
import {
  existsDir,
  fastFolderSizeAsync,
  mkdirIfNotExists,
  parsePackageFile,
  tmpDir,
} from "../utils/fs";
import { checkMatch, makePathPatterns } from "../utils/string";
import {
  RepositoryAbstract,
  BackupDataType,
  InitDataType,
  RestoreDataType,
  SnapshotsDataType,
  SnapshotResultType,
  SnapshotTagEnum,
  SnapshotTagObjectType,
  PruneDataType,
  CopyBackupType,
} from "./RepositoryAbstract";
import { ok } from "assert";
import fg from "fast-glob";
import { copyFile, rm, mkdir } from "fs/promises";
import { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { join, dirname } from "path";

export type GitRepositoryConfigType = {
  repo: string;
  branch?: string;
};

export type GitPackageRepositoryConfigType = {};

export const gitRepositoryName = "git";

export const gitRepositoryDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["repo"],
  properties: {
    repo: { type: "string" },
    branch: { type: "string" },
  },
};

export const gitPackageRepositoryDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

export class GitRepository extends RepositoryAbstract<GitRepositoryConfigType> {
  static refPrefix = "dt";

  override onGetSource() {
    return this.config.repo;
  }

  static buildSnapshotTagName(
    tag: Pick<
      SnapshotTagObjectType,
      SnapshotTagEnum.PACKAGE | SnapshotTagEnum.ID
    >
  ) {
    return `${GitRepository.refPrefix}/${tag.package}/${tag.id}`;
  }

  static buildSnapshotTag(tag: SnapshotTagObjectType) {
    return {
      name: GitRepository.buildSnapshotTagName(tag),
      message: JSON.stringify(tag),
    };
  }

  static isSnapshotTag(name: string) {
    return name.startsWith(`${GitRepository.refPrefix}/`);
  }

  static parseSnapshotTag(name: string, message: string) {
    if (GitRepository.isSnapshotTag(name))
      return JSON.parse(message) as Omit<SnapshotTagObjectType, "tags"> & {
        tags: string[];
      };
    return null;
  }

  static buildBranchName(packageName: string) {
    return `${GitRepository.refPrefix}/${packageName}`;
  }

  override async onInit(data: InitDataType) {
    const git = new Git({
      dir: tmpDir(GitRepository.name + "-snapshot"),
      log: data.options.verbose,
    });

    if (await git.canBeInit(this.config.repo)) {
      await mkdir(git.options.dir);
      await git.exec(["init", "--bare", this.config.repo]);
    }

    const branchName = this.config.branch ?? "master";
    const existsBranch = await git.checkBranch({
      name: branchName,
      repo: this.config.repo,
    });

    if (!existsBranch) {
      await mkdirIfNotExists(git.options.dir);
      await git.clone({
        repo: this.config.repo,
      });
      await git.checkout({
        branchName,
        orphan: true,
      });
      await git.exec(["commit", "-m", "Initial commit", "--allow-empty"]);
      await git.push({ branchName });
    }
  }
  override async onPrune(data: PruneDataType) {
    const git = new Git({
      dir: await this.mkTmpDir(GitRepository.name + "-snapshot"),
      log: data.options.verbose,
    });

    const branchName = GitRepository.buildBranchName(data.snapshot.packageName);
    const commitId = await git.fetchCommitId(data.snapshot.originalId);

    await git.clone({ repo: this.config.repo });
    await git.checkout({
      branchName,
      orphan: (await git.checkBranch({ name: branchName })) ? false : true,
    });

    await git.exec([
      "rebase",
      "-X theirs",
      "--rebase-merges",
      "--onto",
      `${commitId}^`,
      commitId,
    ]);

    await git.exec(["push", "origin", branchName, "--force-with-lease"]);
    await git.exec(["push", "--delete", "origin", data.snapshot.originalId]);
  }
  override async onSnapshots(data: SnapshotsDataType) {
    const git = new Git({
      dir: await this.mkTmpDir(GitRepository.name + "-snapshot"),
      log: data.options.verbose,
    });

    const pkgPatterns = makePathPatterns(data.options.packageNames);
    const pkgTaskPatterns = makePathPatterns(data.options.packageTaskNames);

    await git.clone({ repo: this.config.repo });

    const tagNames = data.options.ids?.map(
      (id) => `${GitRepository.refPrefix}/*/${id}*`
    ) || [`${GitRepository.refPrefix}/*`];
    const tags = await git.getTags(tagNames);

    return tags
      .reduce((result, tag) => {
        const parsedTag = tag.message
          ? GitRepository.parseSnapshotTag(tag.name, tag.message)
          : null;
        if (!parsedTag) return result;

        if (pkgPatterns && !isMatch(parsedTag.package, pkgPatterns))
          return result;

        if (pkgTaskPatterns && !checkMatch(parsedTag.task, pkgTaskPatterns))
          return result;

        if (
          data.options.tags &&
          !parsedTag.tags.some((value) => data.options.tags?.includes(value))
        )
          return result;
        result.push({
          originalId: tag.name,
          id: parsedTag.id,
          date: parsedTag.date,
          packageName: parsedTag.package,
          packageTaskName: parsedTag.task,
          tags: parsedTag.tags,
          size: Number(parsedTag.size) || 0,
        });
        return result;
      }, [] as SnapshotResultType[])
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  override async onBackup(
    data: BackupDataType<GitPackageRepositoryConfigType>
  ) {
    const pkg = data.package;
    const sourcePath = data.targetPath ?? pkg.path;

    ok(typeof sourcePath === "string");

    if (!(await existsDir(sourcePath)))
      throw new AppError(`Package path not exists: ${sourcePath}`);

    const tmpPath = await this.mkTmpDir(GitRepository.name + "-backup");
    const branchName = GitRepository.buildBranchName(data.package.name);

    const git = new Git({
      dir: tmpPath,
      log: data.options.verbose,
    });

    if (data.options.verbose) logExec("cd", [tmpPath]);

    await git.clone({
      repo: this.config.repo,
    });

    await git.checkout({
      branchName,
      orphan: (await git.checkBranch({ name: branchName })) ? false : true,
    });

    await git.removeAll();

    const createdPaths: string[] = [];

    const include = await parsePaths(pkg.include ?? ["**"], {
      cwd: sourcePath,
      verbose: data.options.verbose,
    });

    const exclude = pkg.exclude
      ? await parsePaths(pkg.exclude, {
          cwd: sourcePath,
          verbose: data.options.verbose,
        })
      : undefined;

    const stream = await fg(include, {
      cwd: sourcePath,
      ignore: exclude,
      dot: true,
    });

    let files = 0;

    for await (const entry of stream) {
      const source = join(sourcePath, entry);
      const target = join(tmpPath, entry);
      const dir = dirname(target);
      if (!createdPaths.includes(dir)) {
        await mkdir(dir, {
          recursive: true,
        });
        createdPaths.push(dir);
      }
      files++;
      await copyFile(source, target);
    }

    if (data.options.verbose) console.info(`Copied ${files} files`);

    await git.exec(["add", "--verbose", "."]);

    if (await git.haveChanges())
      await git.exec(["commit", "-m", data.snapshot.id]);

    const nodePkg = parsePackageFile();
    const meta = GitRepository.buildSnapshotTag({
      id: data.snapshot.id,
      shortId: data.snapshot.id.slice(0, 8),
      tags: data.options.tags ?? [],
      date: data.snapshot.date,
      package: data.package.name,
      task: data.package.task?.name,
      version: nodePkg.version,
      size: (
        (await fastFolderSizeAsync(tmpPath)) -
        (await fastFolderSizeAsync(join(tmpPath, ".git")))
      ).toString(),
    });

    await git.addTag(meta.name, meta.message);
    await git.push({ branchName });
    await git.pushTags();

    await rm(tmpPath, {
      recursive: true,
    });
  }
  override onCopyBackup(
    data: CopyBackupType<GitRepositoryConfigType>
  ): Promise<void> {
    throw new Error("Method not implemented.");
  }
  override async onRestore(
    data: RestoreDataType<GitPackageRepositoryConfigType>
  ) {
    const restorePath = data.targetPath ?? data.package.restorePath;

    ok(restorePath);

    const tagName = GitRepository.buildSnapshotTagName({
      id: data.snapshot.id,
      package: data.package.name,
    });

    const git = new Git({
      dir: restorePath,
      log: data.options.verbose,
    });

    if (data.options.verbose) logExec("cd", [restorePath]);

    await git.clone({
      repo: this.config.repo,
      branch: tagName,
    });

    await rm(`${restorePath}/.git`, {
      recursive: true,
    });
  }
}
