import { existsDir, isLocalDir, readDir } from "./fs";
import { exec, ExecSettingsInterface } from "./process";

export class Git {
  constructor(
    readonly options: {
      dir: string;
      log?: boolean;
    },
  ) {}

  async exec(args: string[], settings?: ExecSettingsInterface, cwd?: boolean) {
    return await exec(
      "git",
      args,
      { cwd: cwd === false ? undefined : this.options.dir },
      {
        log: this.options.log,
        ...(settings ?? {}),
      },
    );
  }

  async canBeInit(repo: string) {
    return (
      isLocalDir(repo) &&
      (!(await existsDir(repo)) || !(await readDir(repo)).length)
    );
  }

  async clone(options: { repo: string; branch?: string; orphan?: boolean }) {
    return await this.exec([
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
    return await this.exec([
      "checkout",
      ...(options.orphan ? ["--orphan"] : []),
      options.branchName,
    ]);
  }

  async checkBranch(options: { name: string; repo?: string }) {
    const result = await this.exec(
      [
        "ls-remote",
        "--exit-code",
        ...(options.repo ? [options.repo] : ["--heads", "origin"]),
      ],
      {
        stdout: { save: true },
        onExitCodeError: () => false,
      },
      options.repo ? false : true,
    );
    return result.stdout
      .split(/\r?\n/g)
      .some((line) => line.endsWith(`refs/heads/${options.name}`));
  }

  async removeAll() {
    return await this.exec(["rm", "--force", "--ignore-unmatch", "*"]);
  }

  async haveChanges() {
    const statusResult = await this.exec(["status", "-s"], {
      stdout: { save: true },
    });
    return !!statusResult.stdout.trim().length;
  }

  async fetchCommitId(tag: string) {
    return (
      await this.exec(["rev-list", "-n", "1", tag], { stdout: { save: true } })
    ).stdout?.trim();
  }

  async getTags(names?: string[]) {
    const result = await this.exec(["tag", "-n", ...(names ?? [])], {
      stdout: { save: true },
    });
    return result.stdout.split(/\r?\n/).reduce(
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

  async addTag(name: string, message?: string) {
    if (message) {
      await this.exec(["tag", "-a", name, "-m", message]);
    } else {
      await this.exec(["tag", name]);
    }
  }

  async pushTags() {
    return await this.exec(["push", "--tags"]);
  }

  async push(options: { branchName: string }) {
    return await this.exec([
      "push",
      "--progress",
      "origin",
      options.branchName,
    ]);
  }
}
