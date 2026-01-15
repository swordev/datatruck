import { Config, GlobalConfig } from "../config.js";
import { checkDiskSpace } from "../utils/fs.js";
import { Ntfy } from "../utils/ntfy.js";
import { SnapshotTagEnum } from "@datatruck/cli/repositories/RepositoryAbstract.js";
import { ResticRepository } from "@datatruck/cli/repositories/ResticRepository.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { duration } from "@datatruck/cli/utils/date.js";
import { isLocalDir } from "@datatruck/cli/utils/fs.js";
import { Restic } from "@datatruck/cli/utils/restic.js";

export type CopyRunOptions = {
  packages?: string[];
  source: string;
  targets: string[];
};
export class Copy {
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

  private findRepo(name: string) {
    const repo = this.config.repositories.find((repo) => repo.name === name);
    if (!repo) throw new Error(`Repository '${name}' not found`);
    return repo;
  }

  async run(options: CopyRunOptions) {
    const now = Date.now();
    let globalDiffSize: number | undefined;
    let error: Error | undefined;

    try {
      await this.ntfy.send(`Copy start`, {
        "- Source": options.source,
        "- Targets": options.targets.join(", "),
      });

      const sourceRepo = this.findRepo(options.source);
      const source = new Restic({
        log: this.verbose,
        env: {
          RESTIC_REPOSITORY: sourceRepo.uri,
          RESTIC_PASSWORD: sourceRepo.password,
        },
      });

      const targetRepos = options.targets.map((target) =>
        this.findRepo(target),
      );

      if (!targetRepos.length)
        throw new Error(`No target repositories specified`);

      const inSnapshots = (await source.snapshots({
        latest: 1,
        group: ["path"],
        tags: options.packages
          ? options.packages.map((name) =>
              ResticRepository.createSnapshotTag(SnapshotTagEnum.PACKAGE, name),
            )
          : undefined,
      })) as any as {
        group_key: Record<string, any>;
        snapshots: [{ id: string; short_id: string; tags: string[] }];
      }[];

      const snapshots = inSnapshots.flatMap((s) => s.snapshots);

      for (const targetRepo of targetRepos) {
        const target = new Restic({
          log: this.verbose,
          env: {
            RESTIC_REPOSITORY: targetRepo.uri,
            RESTIC_PASSWORD: targetRepo.password,
            ["GODEBUG" as any]: "http2client=0",
          },
        });
        const exists = await target.checkRepository();
        if (!exists && isLocalDir(targetRepo.uri)) await target.exec(["init"]);
        for (const snapshot of snapshots) {
          const tags = snapshot.tags
            .map((t) => ResticRepository.parseSnapshotTag(t))
            .filter((t) => !!t);
          const pkgTag = tags.find((t) => t.name === SnapshotTagEnum.PACKAGE);
          const packageName = pkgTag?.value;
          const now = Date.now();
          let copyError: Error | undefined;
          let diffSize: number | undefined;
          const targetPath = isLocalDir(targetRepo.uri)
            ? targetRepo.uri
            : undefined;

          try {
            diffSize = await checkDiskSpace({
              minFreeSpace: this.config.minFreeSpace,
              targetPath,
              rutine: () =>
                target.copy({
                  ids: [snapshot.id],
                  fromRepo: sourceRepo.uri,
                  fromRepoPassword: sourceRepo.password,
                }),
            });
            if (diffSize !== undefined) {
              globalDiffSize = (globalDiffSize ?? 0) + (diffSize ?? 0);
            }
          } catch (inError) {
            copyError = inError as any;
          }

          await this.ntfy.send(
            `Copy`,
            {
              "- Id": snapshot.short_id,
              "- Source": sourceRepo.name,
              "- Target": targetRepo.name,
              "- Package": packageName,
              ...(diffSize !== undefined && {
                "- Diff size":
                  (diffSize > 0 ? "+" : "") + formatBytes(diffSize),
              }),
              "- Duration": duration(Date.now() - now),
              "- Error": copyError?.message,
            },
            {
              priority: copyError ? "high" : "default",
              tags: [copyError ? "red_circle" : "green_circle"],
            },
          );
        }
      }
    } catch (inError) {
      error = inError as any;
    }
    await this.ntfy.send(
      `Copy end`,
      {
        ...(globalDiffSize !== undefined && {
          "- Diff size":
            (globalDiffSize > 0 ? "+" : "") + formatBytes(globalDiffSize),
        }),
        "- Duration": duration(Date.now() - now),
        "- Error": error?.message,
      },
      {
        priority: error ? "high" : "default",
        tags: [error ? "red_circle" : "green_circle"],
      },
    );
  }
}
