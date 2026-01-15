import { Config, GlobalConfig } from "../config.js";
import { Ntfy } from "../utils/ntfy.js";
import { duration } from "@datatruck/cli/utils/date.js";
import { isLocalDir } from "@datatruck/cli/utils/fs.js";
import { Restic } from "@datatruck/cli/utils/restic.js";

export type InitOptions = {
  repositories?: string[];
};

export class Init {
  readonly ntfy: Ntfy;
  protected verbose: boolean | undefined;
  constructor(
    readonly config: Config,
    readonly global?: GlobalConfig,
  ) {
    this.verbose = this.global?.verbose ?? this.config.verbose;
    this.ntfy = new Ntfy({
      token: this.config.ntfyToken,
      titlePrefix: `[${this.config.hostname}] `,
    });
  }

  async run(options: InitOptions) {
    const now = Date.now();
    await this.ntfy.send(`Init start`, {});
    const repositories =
      options.repositories ?? this.config.repositories.map((r) => r.name);
    for (const name of repositories) {
      let error: Error | undefined;
      let exists: boolean | undefined;
      try {
        const repo = this.config.repositories.find(
          (repo) => repo.name === name,
        );
        if (!repo) throw new Error(`Repository not found`);
        const source = new Restic({
          log: this.verbose,
          env: {
            RESTIC_REPOSITORY: repo.uri,
            RESTIC_PASSWORD: repo.password,
          },
        });
        exists = await source.checkRepository();
        if (!exists && isLocalDir(repo.uri)) await source.exec(["init"]);
      } catch (inError) {
        error = inError as any;
      }
      await this.ntfy.send(
        `Init`,
        {
          "- Repository": name,
          "- Exists": exists ? "yes" : "no",
          "- Duration": duration(Date.now() - now),
          "- Error": error?.message,
        },
        {
          priority: error ? "high" : "default",
          tags: [error ? "red_circle" : "green_circle"],
        },
      );
    }
    await this.ntfy.send(`Init end`, {});
  }
}
