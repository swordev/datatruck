import { Action } from "./base.js";
import { logExec } from "@datatruck/cli/utils/cli.js";
import { spawnSync } from "child_process";

export type RunOptions = {
  repository: string;
  args: string[];
};

export class Run extends Action {
  async run(options: RunOptions) {
    const [restic] = this.cm.createRestic(options.repository, this.verbose);
    if (this.verbose) logExec("restic", options.args, restic.options.env);
    const p = spawnSync("restic", options.args, {
      stdio: "inherit",
      env: { ...process.env, ...restic.options.env },
    });
    if (p.status) process.exit(p.status);
  }
}
