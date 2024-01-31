import { logExec } from "../utils/cli";
import { createPkgFilter, createTaskFilter } from "../utils/datatruck/config";
import { BackupPathsOptions, parseBackupPaths } from "../utils/datatruck/paths";
import {
  fastFolderSizeAsync,
  fetchDiskStats,
  isLocalDir,
  mkdirIfNotExists,
  parsePackageFile,
} from "../utils/fs";
import { Git } from "../utils/git";
import { mkTmpDir, tmpDir } from "../utils/temp";
import {
  RepositoryAbstract,
  RepoBackupData,
  RepoInitData,
  RepoRestoreData,
  RepoFetchSnapshotsData,
  Snapshot,
  SnapshotTagEnum,
  SnapshotTagObject,
  RepoPruneData,
  RepoCopyData,
} from "./RepositoryAbstract";
import fg from "fast-glob";
import { copyFile, rm, mkdir } from "fs/promises";
import { join, dirname } from "path";

export type GitRepositoryConfig = {
  repo: string;
  branch?: string;
};

export type GitPackageRepositoryConfig = {};

export const gitRepositoryName = "git";

export class GitRepository extends RepositoryAbstract<GitRepositoryConfig> {
  static refPrefix = "dt";

  override getSource() {
    return this.config.repo;
  }
  override async fetchDiskStats(config: GitRepositoryConfig) {
    if (isLocalDir(config.repo)) return await fetchDiskStats(config.repo);
  }

  static createSnapshotTagName(
    tag: Pick<SnapshotTagObject, SnapshotTagEnum.PACKAGE | SnapshotTagEnum.ID>,
  ) {
    return `${GitRepository.refPrefix}/${tag.package}/${tag.id}`;
  }

  static createSnapshotTags(tags: SnapshotTagObject) {
    return {
      name: GitRepository.createSnapshotTagName(tags),
      message: JSON.stringify(tags),
    };
  }

  static isSnapshotTag(name: string) {
    return name.startsWith(`${GitRepository.refPrefix}/`);
  }

  static parseSnapshotTags(
    name: string,
    message: string,
  ): SnapshotTagObject | null {
    if (GitRepository.isSnapshotTag(name)) return JSON.parse(message);
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
      await git.commit("Initial commit", {
        allowEmpty: true,
        userName: "datatruck",
        userEmail: "datatruck@localhost",
      });
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

    await git.clone({ repo: this.config.repo });

    const tagNames = data.options.ids?.map(
      (id) => `${GitRepository.refPrefix}/*/${id}*`,
    ) || [`${GitRepository.refPrefix}/*`];
    const tags = await git.getTags(tagNames);

    const filterPkg = createPkgFilter(data.options.packageNames);
    const filterTask = createTaskFilter(data.options.packageTaskNames);

    return tags
      .reduce((result, tag) => {
        const parsedTag = tag.message
          ? GitRepository.parseSnapshotTags(tag.name, tag.message)
          : null;
        if (!parsedTag) return result;

        if (!filterPkg(parsedTag.package)) return result;
        if (!filterTask(parsedTag.task)) return result;

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
          hostname: parsedTag.hostname ?? "",
          size: Number(parsedTag.size) || 0,
        });
        return result;
      }, [] as Snapshot[])
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  override async backup(data: RepoBackupData<GitPackageRepositoryConfig>) {
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

    if (await git.haveChanges()) {
      await git.commit(data.snapshot.id, {
        userName: "datatruck",
        userEmail: "datatruck@localhost",
      });
    }

    const nodePkg = parsePackageFile();
    const size =
      (await fastFolderSizeAsync(tmpPath)) -
      (await fastFolderSizeAsync(join(tmpPath, ".git")));
    const meta = GitRepository.createSnapshotTags({
      id: data.snapshot.id,
      hostname: data.hostname,
      shortId: data.snapshot.id.slice(0, 8),
      tags: data.options.tags ?? [],
      date: data.snapshot.date,
      package: data.package.name,
      task: data.package.task?.name,
      version: nodePkg.version,
      size: size.toString(),
    });

    await git.addTag(meta.name, meta.message);
    await git.push({ branchName });
    await git.pushTags();

    await rm(tmpPath, { recursive: true });

    return {
      bytes: size,
    };
  }
  override async copy(data: RepoCopyData<GitRepositoryConfig>) {
    throw new Error("Method not implemented.");
    return { bytes: 0 };
  }
  override async restore(data: RepoRestoreData<GitPackageRepositoryConfig>) {
    const restorePath = data.snapshotPath;

    const tagName = GitRepository.createSnapshotTagName({
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
