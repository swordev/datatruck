import { createRunner } from "../utils/async.js";
import { Action } from "./base.js";
import { Restic } from "@datatruck/cli/utils/restic.js";

export type InitOptions = {
  repositories?: string[];
};

export class Init extends Action {
  protected async runSingle(name: string) {
    let exists: boolean | undefined;
    await createRunner(async () => {
      const repo = this.cm.findRepository(name);
      const restic = new Restic({
        log: this.verbose,
        env: {
          RESTIC_REPOSITORY: repo.uri,
          RESTIC_PASSWORD: repo.password,
        },
      });
      exists = await restic.tryInit();
    }).start(async (data) => {
      await this.ntfy.send(
        `Init`,
        {
          Repository: name,
          Exists: exists ? "yes" : "no",
          Duration: data.duration,
          Error: data.error?.message,
        },
        data.error,
      );
    });
  }

  async run(options: InitOptions) {
    await createRunner(async () => {
      const repositories = this.cm.filterRepositories(options.repositories);
      await this.ntfy.send(`Init start`, {
        Repositories: repositories.length,
      });
      for (const repo of repositories) await this.runSingle(repo.name);
    }).start(async (data) => {
      await this.ntfy.send(`Init end`, {
        Duration: data.duration,
        Error: data.error?.message,
      });
    });
  }
}
