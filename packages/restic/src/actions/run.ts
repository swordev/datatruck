import { Action } from "./base.js";
import { spawnSync } from "child_process";

export type RunOptions = {
  repository: string;
  args: string[];
};

export class Run extends Action {
  async run(options: RunOptions) {
    const [restic] = this.cm.createRestic(options.repository, this.verbose);
    const p = restic["createProcess"](options.args, { $log: true });
    const exit = spawnSync(
      p["command"],
      p["argv"]?.map((v: string | number) => v.toString()),
      { stdio: "inherit", env: p["options"]?.env },
    );
    if (exit.status) process.exit(exit.status);
  }
}
