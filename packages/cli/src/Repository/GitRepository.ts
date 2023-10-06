import { Git } from "../utils/Git";
import { logExec } from "../utils/cli";
import { BackupPathsOptions, parseBackupPaths } from "../utils/datatruck/paths";
import {
  fastFolderSizeAsync,
  mkdirIfNotExists,
  parsePackageFile,
} from "../utils/fs";
import { checkMatch, makePathPatterns } from "../utils/string";
import { mkTmpDir, tmpDir } from "../utils/temp";
import {
  RepositoryAbstract,
  RepoBackupData,
  RepoInitData,
  RepoRestoreData,
  RepoFetchSnapshotsData,
  Snapshot,
  SnapshotTagEnum,
  SnapshotTagObjectType,
  RepoPruneData,
  RepoCopyData,
} from "./RepositoryAbstract";
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

  override getSource() {
    return this.config.repo;
  }

  static buildSnapshotTagName(
    tag: Pick<
      SnapshotTagObjectType,
      SnapshotTagEnum.PACKAGE | SnapshotTagEnum.ID
    >,
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

  override async init(data: RepoInitData) {
    const git = new Git({
      dir: tmpDir(gitRepositoryName, "repository", "init"),
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
  override async prune(data: RepoPruneData) {
    const git = new Git({
      dir: await mkTmpDir(gitRepositoryName, "repo", "prune"),
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
  override async fetchSnapshots(data: RepoFetchSnapshotsData) {
    const git = new Git({
      dir: await mkTmpDir(gitRepositoryName, "repo", "snapshots"),
      log: data.options.verbose,
    });

    const pkgPatterns = makePathPatterns(data.options.packageNames);
    const pkgTaskPatterns = makePathPatterns(data.options.packageTaskNames);

    await git.clone({ repo: this.config.repo });

    const tagNames = data.options.ids?.map(
      (id) => `${GitRepository.refPrefix}/*/${id}*`,
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
      }, [] as Snapshot[])
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  override async backup(data: RepoBackupData<GitPackageRepositoryConfigType>) {
    const pkg = data.package;
    const path = pkg.path;
    const tmpPath = await mkTmpDir(gitRepositoryName, "repo", "backup");
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

    const backupPathsOptions: BackupPathsOptions = {
      package: data.package,
      snapshot: data.snapshot,
      path: path,
      verbose: data.options.verbose,
    };

    const include = await parseBackupPaths(
      pkg.include ?? ["**"],
      backupPathsOptions,
    );

    const exclude = pkg.exclude
      ? await parseBackupPaths(pkg.exclude, backupPathsOptions)
      : undefined;

    const stream = await fg(include, {
      cwd: path,
      ignore: exclude,
      dot: true,
    });

    let files = 0;

    for await (const entry of stream) {
      const source = join(path, entry);
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

    await rm(tmpPath, { recursive: true });
  }
  override copy(data: RepoCopyData<GitRepositoryConfigType>): Promise<void> {
    throw new Error("Method not implemented.");
  }
  override async restore(
    data: RepoRestoreData<GitPackageRepositoryConfigType>,
  ) {
    const restorePath = data.snapshotPath;

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
