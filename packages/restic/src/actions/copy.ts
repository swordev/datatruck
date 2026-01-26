import { createRunner } from "../utils/async.js";
import { checkDiskSpace } from "../utils/fs.js";
import { parseTags, stringifyTags } from "../utils/tags.js";
import { Action } from "./base.js";
import { Prune } from "./prune.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { isLocalDir } from "@datatruck/cli/utils/fs.js";
import { Restic } from "@datatruck/cli/utils/restic.js";

export type CopyOptions = {
  packages?: string[];
  source: string;
  targets: string[];
  prune?: boolean;
};

export class Copy extends Action {
  protected initializedRepos: Set<string> = new Set();

  private async findSnapshots(name: string, packages?: string[]) {
    const repo = this.cm.findRepository(name);
    const restic = new Restic({
      log: this.verbose,
      env: {
        RESTIC_REPOSITORY: repo.uri,
        RESTIC_PASSWORD: repo.password,
      },
    });
    const snapshots = (await restic.snapshots({
      latest: 1,
      group: ["path"],
      tags: packages
        ? packages.flatMap((name) => stringifyTags({ pkg: name }))
        : undefined,
    })) as any as {
      group_key: Record<string, any>;
      snapshots: [{ id: string; short_id: string; tags: string[] }];
    }[];
    return snapshots.flatMap((s) => s.snapshots);
  }

  async runSingle(options: {
    source: string;
    target: string;
    snapshot: {
      id: string;
      short_id: string;
      tags: string[];
    };
  }) {
    const { snapshot } = options;
    const targetRepo = this.cm.findRepository(options.target);
    const sourceRepo = this.cm.findRepository(options.source);
    const packageName = parseTags(snapshot.tags).pkg;
    const targetPath = isLocalDir(targetRepo.uri) ? targetRepo.uri : undefined;
    const target = new Restic({
      log: this.verbose,
      env: {
        RESTIC_REPOSITORY: targetRepo.uri,
        RESTIC_PASSWORD: targetRepo.password,
        ["GODEBUG" as any]: "http2client=0",
      },
    });

    let space: { diff: number; size: number } | undefined;

    await createRunner(async () => {
      if (!this.initializedRepos.has(targetRepo.name)) {
        await target.tryInit();
        this.initializedRepos.add(targetRepo.name);
      }
      space = await checkDiskSpace({
        minFreeSpace: this.config.minFreeSpace,
        targetPath,
        rutine: () =>
          target.copy({
            ids: [snapshot.id],
            fromRepo: sourceRepo.uri,
            fromRepoPassword: sourceRepo.password,
          }),
      });
    }).start(async (data) => {
      await this.ntfy.send(
        `Copy`,
        {
          Id: snapshot.short_id,
          Source: sourceRepo.name,
          Target: targetRepo.name,
          Package: packageName,
          ...(space !== undefined && {
            Size: `${formatBytes(space.size)} (${formatBytes(space.diff, true)})`,
          }),
          Duration: data.duration,
          Error: data.error?.message,
        },
        data.error,
      );
    });

    return space?.diff ?? 0;
  }

  async run(options: CopyOptions) {
    let globalDiffSize: number | undefined;

    await createRunner(async () => {
      const [source] = this.cm.filterRepositories([options.source]);
      const targets = this.cm.filterRepositories(options.targets);

      await this.ntfy.send(`Copy start`, {
        Source: source.name,
        Targets: targets.map((t) => t.name).join(", "),
      });

      const snapshots = await this.findSnapshots(source.name, options.packages);

      for (const target of targets) {
        for (const snapshot of snapshots) {
          const diffSize = await this.runSingle({
            snapshot,
            source: source.name,
            target: target.name,
          });
          globalDiffSize = (globalDiffSize ?? 0) + diffSize;
        }
      }

      if (!options.targets.length)
        throw new Error(`No target repositories specified`);
    }).start(async (data) => {
      await this.ntfy.send(
        `Copy end`,
        {
          ...(globalDiffSize !== undefined && {
            "Diff size": formatBytes(globalDiffSize, true),
          }),
          Duration: data.duration,
          Error: data.error?.message,
        },
        data.error,
      );
      if (options.prune) {
        await new Prune(this.config, this.global).run({
          packages: options.packages,
          repositories: options.targets,
        });
      }
    });
  }
}
