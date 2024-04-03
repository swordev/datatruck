import { AsyncProcess, AsyncProcessOptions } from "./async-process";
import { existsDir, isLocalDir, readDir } from "./fs";

export class Git {
  constructor(
    readonly options: {
      dir: string;
      log?: boolean;
    },
  ) {}

  private createProcess(args: string[], options: AsyncProcessOptions = {}) {
    return new AsyncProcess("git", args, {
      $log: this.options.log,
      cwd: this.options.dir,
      ...options,
    });
  }
  async exec(args: string[], options?: AsyncProcessOptions) {
    return await this.createProcess(args, options).waitForClose();
  }
  private async stdout(args: string[], options?: AsyncProcessOptions) {
    return await this.createProcess(args, options).stdout.fetch();
  }

  async canBeInit(repo: string) {
    return (
      isLocalDir(repo) &&
      (!(await existsDir(repo)) || !(await readDir(repo)).length)
    );
  }

  async clone(options: { repo: string; branch?: string; orphan?: boolean }) {
    await this.exec([
      "clone",
      ...(/^\w+\:\/\//.test(options.repo) ? ["--depth=1"] : []),
      ...(options.orphan ? ["--orphan"] : []),
      ...(options.branch ? ["--branch", options.branch] : []),
      "--config",
      "core.autocrlf=false",
      options.repo,
      ".",
    ]);
  }

  async checkout(options: { branchName: string; orphan?: boolean }) {
    await this.exec([
      "checkout",
      ...(options.orphan ? ["--orphan"] : []),
      options.branchName,
    ]);
  }

  async checkBranch(options: { name: string; repo?: string }) {
    const stdout = await this.stdout(
      [
        "ls-remote",
        "--exit-code",
        ...(options.repo ? [options.repo] : ["--heads", "origin"]),
      ],
      {
        ...(options.repo && {
          cwd: undefined,
        }),
        cwd: options.repo ? undefined : this.options.dir,
        $exitCode: false,
      },
    );
    return stdout
      .split(/\r?\n/g)
      .some((line) => line.endsWith(`refs/heads/${options.name}`));
  }

  async removeAll() {
    await this.exec(["rm", "--force", "--ignore-unmatch", "*"]);
  }

  async haveChanges() {
    const stdout = await this.stdout(["status", "-s"]);
    return !!stdout.trim().length;
  }

  async fetchCommitId(tag: string) {
    return (await this.stdout(["rev-list", "-n", "1", tag])).trim();
  }

  async commit(
    description: string,
    options: {
      allowEmpty?: boolean;
      userName?: string;
      userEmail?: string;
    } = {},
  ) {
    await this.exec([
      ...(options.userName ? ["-c", `user.name='${options.userName}'`] : []),
      ...(options.userEmail ? ["-c", `user.email='${options.userEmail}'`] : []),
      "commit",
      "-m",
      description,
      ...(options.allowEmpty ? ["--allow-empty"] : []),
    ]);
  }

  async getTags(names?: string[]) {
    const stdout = await this.stdout(["tag", "-n", ...(names ?? [])]);
    return stdout.split(/\r?\n/).reduce(
      (result, value) => {
        value = value.trim();
        if (!value.length) return result;
        let separatorIndex = value.indexOf(" ");
        if (separatorIndex === -1) separatorIndex = value.length;
        const name = value.slice(0, separatorIndex);
        const message = value.slice(separatorIndex + 1);
        result.push({
          name: name,
          message: message ?? null,
        });
        return result;
      },
      [] as { name: string; message?: string }[],
    );
  }

  async addTag(
    name: string,
    message?: string,
    options: {
      allowEmpty?: boolean;
      userName?: string;
      userEmail?: string;
    } = {},
  ) {
    const commit = [
      ...(options.userName ? ["-c", `user.name='${options.userName}'`] : []),
      ...(options.userEmail ? ["-c", `user.email='${options.userEmail}'`] : []),
    ];
    if (message) {
      await this.exec([...commit, "tag", "-a", name, "-m", message]);
    } else {
      await this.exec([...commit, "tag", name]);
    }
  }

  async pushTags() {
    await this.exec(["push", "--tags"]);
  }

  async push(options: { branchName: string }) {
    await this.exec(["push", "--progress", "origin", options.branchName]);
  }
}
