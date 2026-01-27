import { PrunePolicy } from "../config.js";
import { createRunner, safeRun } from "../utils/async.js";
import { checkDiskSpace, fetchMultipleDiskStats } from "../utils/fs.js";
import { parseTags, stringifyTags } from "../utils/tags.js";
import { Action } from "./base.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { isLocalDir } from "@datatruck/cli/utils/fs.js";
import { progressPercent } from "@datatruck/cli/utils/math.js";
import { match } from "@datatruck/cli/utils/string.js";

export type PruneOptions = {
  packages?: string[];
  repositories?: string[];
};

export class Prune extends Action {
  protected async runSingle(
    repoName: string,
    pkgName: string,
    policy: PrunePolicy,
  ) {
    let logId: string | undefined;
    let stats: { keep: number; remove: number } | undefined;
    let space: { diff: number; size: number } | undefined;
    let removed: number | undefined;
    await createRunner(async () => {
      logId = await this.ntfy.send("Prune", {
        Repository: repoName,
        Package: pkgName,
      });
      const [restic, repo] = this.cm.createRestic(repoName, this.verbose);
      const targetPath = isLocalDir(repo.uri) ? repo.uri : undefined;

      space = await checkDiskSpace({
        minFreeSpace: this.config.minFreeSpace,
        targetPath,
        rutine: async () => {
          const results = await restic.forget({
            ...policy,
            json: true,
            prune: true,
            args: ["--group-by", ""],
            tag: stringifyTags({ pkg: pkgName }),
          });
          stats = {
            keep: results.at(0)?.keep?.length ?? 0,
            remove: results.at(0)?.remove?.length ?? 0,
          };
        },
      });
    }).start(async (data) => {
      if (stats) removed = stats.remove;
      await this.ntfy.send(
        `Prune`,
        {
          Repository: repoName,
          Package: pkgName,
          ...(stats && {
            Keeped: `${stats.keep}`,
            Removed: `${stats.remove}`,
          }),
          ...(space !== undefined && {
            Size: `${formatBytes(space.size)} (${formatBytes(space.diff, true)})`,
          }),
          Duration: data.duration,
          Error: data.error?.message,
        },
        { error: data.error, logId },
      );
    });
    return {
      diffSize: space?.diff ?? 0,
      removed,
    };
  }

  protected async fetchPackages(repoName: string): Promise<string[]> {
    const [restic] = this.cm.createRestic(repoName, this.verbose);
    if (!(await restic.checkRepository())) return [];
    const snapshots = await restic.snapshots({ json: true });
    const packages = new Set(snapshots.map((s) => parseTags(s.tags ?? []).pkg));
    return [...packages].filter((v) => typeof v === "string");
  }

  async run(options: PruneOptions) {
    let globalDiffSize: number | undefined;
    let globalRemoved = 0;
    let localRepositoryPaths: string[] = [];
    await createRunner(async () => {
      const repositories = this.cm.filterRepositories(options.repositories);

      await this.ntfy.send(`Prune start`, {
        Repositories: repositories.length,
      });

      localRepositoryPaths = repositories
        .filter((repo) => isLocalDir(repo.uri))
        .map((repo) => repo.uri);

      let some = false;

      for (const repo of repositories) {
        const inPackageNames = await this.fetchPackages(repo.name);
        const packageNames = inPackageNames.filter((pkgName) =>
          options.packages ? match(pkgName, options.packages) : true,
        );
        for (const pkgName of packageNames) {
          const pkg = this.config.packages.find((pkg) => pkg.name === pkgName);
          const policy =
            pkg?.prunePolicy ?? repo.prunePolicy ?? this.config.prunePolicy;
          if (policy) {
            const { diffSize, removed } = await this.runSingle(
              repo.name,
              pkgName,
              policy,
            );
            some = true;
            if (diffSize !== undefined)
              globalDiffSize = (globalDiffSize ?? 0) + diffSize;
            if (removed !== undefined) globalRemoved += removed;
          }
        }
      }

      if (options.packages && !some)
        throw new Error(
          `No packages found for filter: ${options.packages.join(", ")}`,
        );
    }).start(async (data) => {
      const diskStats = await safeRun(() =>
        fetchMultipleDiskStats(localRepositoryPaths),
      );
      if (diskStats.error) console.error(diskStats.error);
      await this.ntfy.send(`Prune end`, {
        Duration: data.duration,
        Removed: globalRemoved,
        ...(globalDiffSize !== undefined && {
          "Diff size":
            (globalDiffSize > 0 ? "+" : "") + formatBytes(globalDiffSize),
        }),
        Error: data.error?.message,
        "": [
          !!diskStats.result?.length && { key: "Disk stats", value: "" },
          ...(diskStats.result?.map((p) => ({
            key: p.name,
            value: `${formatBytes(p.occupied)}/${formatBytes(p.total)} (${progressPercent(p.total, p.occupied)}%)`,
            level: 1,
          })) || []),
        ],
      });
    });
  }
}
