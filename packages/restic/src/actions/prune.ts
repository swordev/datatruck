import { PrunePolicy } from "../config.js";
import { createRunner } from "../utils/async.js";
import { checkDiskSpace } from "../utils/fs.js";
import { Action } from "./base.js";
import { SnapshotTagEnum } from "@datatruck/cli/repositories/RepositoryAbstract.js";
import { ResticRepository } from "@datatruck/cli/repositories/ResticRepository.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { isLocalDir } from "@datatruck/cli/utils/fs.js";
import { Restic } from "@datatruck/cli/utils/restic.js";

export type PruneRunOptions = {
  packages?: string[];
  repositories?: string[];
};

export class Prune extends Action {
  protected async runSingle(
    repoName: string,
    pkgName: string,
    policy: PrunePolicy,
  ) {
    let stats: { keep: number; remove: number } | undefined;
    let diffSize: number | undefined;
    await createRunner(async () => {
      const repo = this.cm.findRepository(repoName);
      const pkg = this.cm.findPackage(pkgName);
      const restic = new Restic({
        log: this.verbose,
        env: {
          RESTIC_REPOSITORY: repo.uri,
          RESTIC_PASSWORD: repo.password,
        },
      });

      const targetPath = isLocalDir(repo.uri) ? repo.uri : undefined;

      diffSize = await checkDiskSpace({
        minFreeSpace: this.config.minFreeSpace,
        targetPath,
        rutine: async () => {
          const results = await restic.forget({
            ...policy,
            json: true,
            prune: true,
            args: ["--group-by", ""],
            tag: [
              ResticRepository.createSnapshotTag(
                SnapshotTagEnum.PACKAGE,
                pkg.name,
              ),
            ],
          });
          stats = {
            keep: results.at(0)?.keep?.length ?? 0,
            remove: results.at(0)?.remove?.length ?? 0,
          };
        },
      });
    }).start(async (data) => {
      await this.ntfy.send(
        `Prune`,
        {
          "- Repository": repoName,
          "- Package": pkgName,
          ...(stats && {
            "- Snapshots": `${stats.keep}`,
            "- Removed": `${stats.remove}`,
          }),
          ...(diffSize !== undefined && {
            "- Diff size": (diffSize > 0 ? "+" : "") + formatBytes(diffSize),
          }),
          "- Duration": data.duration,
          "- Error": data.error?.message,
        },
        data.error,
      );
    });
    return diffSize;
  }

  async run(options: PruneRunOptions) {
    let globalDiffSize: number | undefined;
    await createRunner(async () => {
      const repositories = this.cm.filterRepositories(options.repositories);
      const packages = this.cm.filterPackages(options.packages);

      await this.ntfy.send(`Prune start`, {
        "- Repositories": repositories.length,
        "- Packages": packages.length,
      });

      for (const repo of repositories) {
        for (const pkg of packages) {
          const policy =
            pkg.prunePolicy ?? repo.prunePolicy ?? this.config.prunePolicy;
          if (policy) {
            const diffSize = await this.runSingle(repo.name, pkg.name, policy);
            if (diffSize !== undefined)
              globalDiffSize = (globalDiffSize ?? 0) + diffSize;
          }
        }
      }
    }).start(async (data) => {
      await this.ntfy.send(`Prune end`, {
        "- Duration": data.duration,
        ...(globalDiffSize !== undefined && {
          "- Diff size":
            (globalDiffSize > 0 ? "+" : "") + formatBytes(globalDiffSize),
        }),
        "- Error": data.error?.message,
      });
    });
  }
}
