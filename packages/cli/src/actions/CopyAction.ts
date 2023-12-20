import {
  RepositoryAbstract,
  Snapshot,
} from "../repositories/RepositoryAbstract";
import { DataFormat } from "../utils/DataFormat";
import { renderError, renderObject, renderResult } from "../utils/cli";
import {
  filterRepository,
  findPackageOrFail,
  findPackageRepositoryConfig,
  findRepositoryOrFail,
  sortReposByType,
} from "../utils/datatruck/config";
import type { Config, RepositoryConfig } from "../utils/datatruck/config-type";
import { createAndInitRepo } from "../utils/datatruck/repository";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { duration } from "../utils/date";
import { Listr3, Listr3TaskResultEnd } from "../utils/list";
import { StrictMap } from "../utils/object";
import { Progress, ProgressManager, ProgressMode } from "../utils/progress";
import { Streams } from "../utils/stream";
import { ensureFreeDiskTempSpace, useTempDir } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import chalk from "chalk";

export type CopyActionOptions = {
  ids?: string[];
  last?: number;
  repositoryName: string;
  packageNames?: string[];
  packageTaskNames?: string[];
  repositoryNames2?: string[];
  verbose?: boolean;
  tty?: "auto" | boolean;
  progress?: ProgressMode;
};

export type CopyActionResult = {
  errors: Error[];
};

export type Context = {
  snapshots: {
    snapshots: Snapshot[];
  };
  copy: {
    snapshotId: string;
    packageName: string;
    repositoryName: string;
    mirrorRepositoryName: string;
    skipped: boolean;
  };
};

export class CopyAction<TRequired extends boolean = true> {
  constructor(
    readonly config: Config,
    readonly options: IfRequireKeys<TRequired, CopyActionOptions>,
  ) {}
  dataFormat(
    result: Listr3TaskResultEnd<Context>[],
    options: {
      streams?: Streams;
      verbose?: number;
    } = {},
  ) {
    const renderTitle = (
      item: Listr3TaskResultEnd<Context>,
      color?: boolean,
    ) => {
      let title = item.key.slice(0, 1).toUpperCase() + item.key.slice(1);
      return item.key === "copy" && color ? chalk.cyan(title) : title;
    };
    const renderData = (
      item: Listr3TaskResultEnd<Context>,
      color?: boolean,
      items: Listr3TaskResultEnd<Context>[] = [],
    ) => {
      const g = (v: string) => (color ? `${chalk.gray(`(${v})`)}` : `(${v})`);
      return item.key === "snapshots"
        ? item.data.snapshots.length
        : item.key === "copy"
          ? `${item.data.packageName} ${g(
              [
                item.data.snapshotId.slice(0, 8),
                item.data.mirrorRepositoryName,
              ].join(" "),
            )}`
          : item.key === "summary"
            ? renderObject(
                {
                  errors: item.data.errors,
                  copied: items.filter(
                    (i) => i.key === "copy" && !i.error && !i.data.skipped,
                  ).length,
                  skipped: items.filter(
                    (i) => i.key === "copy" && !i.error && i.data.skipped,
                  ).length,
                },
                color,
              )
            : "";
    };
    return new DataFormat({
      streams: options.streams,
      json: result,
      table: {
        headers: [
          { value: "", width: 3 },
          { value: "Title", width: 15 },
          { value: "Data" },
          { value: "Duration", width: 10 },
          { value: "Error", width: 50 },
        ],
        rows: () =>
          result.map((item) => [
            renderResult(item.error),
            renderTitle(item, true),
            renderData(item, true, result),
            duration(item.elapsed),
            renderError(item.error, options.verbose),
          ]),
      },
    });
  }
  protected async fetchSnapshots(repo: RepositoryAbstract<any>) {
    const snapshots = await repo.fetchSnapshots({
      options: {
        ids: this.options.ids,
        packageNames: this.options.packageNames,
        packageTaskNames: this.options.packageTaskNames,
        verbose: this.options.verbose,
      },
    });
    const result = this.options.last
      ? groupAndFilter(snapshots, ["packageName"], {
          last: this.options.last,
        }).map(({ item }) => item)
      : snapshots;

    if (!result.length) throw new Error("No snapshots found");
    return result;
  }
  protected createSourceRepoMap() {
    return new StrictMap<
      [Pick<Snapshot, "id" | "packageName">, Pick<RepositoryConfig, "type">],
      RepositoryAbstract<any>
    >(([snapshot, config]) =>
      [config.type, snapshot.id, snapshot.packageName].join("|"),
    );
  }
  protected async copyCrossRepository(options: {
    repo: RepositoryAbstract<any>;
    repoConfig: RepositoryConfig;
    mirrorRepo: RepositoryAbstract<any>;
    mirrorConfig: RepositoryConfig;
    snapshot: Snapshot;
    onProgress: (p: Progress) => void;
  }) {
    const { repo, repoConfig, mirrorRepo, mirrorConfig, snapshot } = options;
    await using tmp = await useTempDir("copy", "restore");
    const pkg = findPackageOrFail(this.config, snapshot.packageName);
    await repo.restore({
      options: {
        verbose: this.options.verbose,
        snapshotId: snapshot.id,
      },
      snapshot: { id: snapshot.id, date: snapshot.date },
      package: { name: snapshot.packageName },
      packageConfig: findPackageRepositoryConfig(pkg, repoConfig),
      snapshotPath: tmp.path,
      onProgress: options.onProgress,
    });
    if (this.config.minFreeDiskSpace)
      await mirrorRepo.ensureFreeDiskSpace(
        mirrorConfig.config,
        this.config.minFreeDiskSpace,
      );
    await mirrorRepo.backup({
      options: {
        verbose: this.options.verbose,
        tags: snapshot.tags,
      },
      snapshot: { id: snapshot.id, date: snapshot.date },
      package: {
        name: snapshot.packageName,
        path: tmp.path,
      },
      packageConfig: findPackageRepositoryConfig(pkg, mirrorConfig),
      onProgress: options.onProgress,
    });
  }
  async exec() {
    const { options } = this;
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: options.tty,
      mode: options.progress,
    });

    const l = new Listr3<Context>({ progressManager: pm });

    return l
      .add(
        l.$task({
          key: "snapshots",
          data: { snapshots: [] },
          title: {
            initial: "Fetch snapshots",
            started: "Fetching snapshots",
            completed: "Snapshots fetched",
            failed: "Snapshot fetch failed",
          },
          run: async (task, data) => {
            if (this.config.minFreeDiskSpace)
              await ensureFreeDiskTempSpace(this.config.minFreeDiskSpace);
            const repoConfig = findRepositoryOrFail(
              this.config,
              this.options.repositoryName,
            );
            const repo = await createAndInitRepo(
              repoConfig,
              this.options.verbose,
            );
            data.snapshots = await this.fetchSnapshots(repo);
            task.title = `Snapshots fetched: ${data.snapshots.length}`;

            const repositoryNames2 = sortReposByType(
              filterRepository(this.config.repositories, {
                include: this.options.repositoryNames2,
                exclude: [repoConfig.name],
                action: "backup",
              }),
              [repoConfig.type],
            );

            if (!repositoryNames2.length)
              throw new Error("No mirror snapshots found");

            const sourceRepoMap = this.createSourceRepoMap();

            return data.snapshots.flatMap((snapshot) =>
              repositoryNames2.map((repo2) => {
                const id = snapshot.id.slice(0, 8);
                const pkgName = snapshot.packageName;
                return l.$task({
                  key: "copy",
                  keyIndex: [snapshot.packageName, repo2.name, snapshot.id],
                  data: {
                    snapshotId: snapshot.id,
                    packageName: snapshot.packageName,
                    repositoryName: repoConfig.name,
                    mirrorRepositoryName: repo2.name,
                    skipped: false,
                  },
                  title: {
                    initial: `Copy snapshot: ${pkgName} (${id}) » ${repo2.name}`,
                    started: `Copying snapshot: ${pkgName} (${id}) » ${repo2.name}`,
                    completed: `Snapshot copied: ${pkgName} (${id}) » ${repo2.name}`,
                    failed: `Snapshot copy failed: ${pkgName} (${id}) » ${repo2.name}`,
                  },
                  exitOnError: false,
                  run: async (task, data) => {
                    const mirrorConfig = findRepositoryOrFail(
                      this.config,
                      repo2.name,
                    );
                    const mirrorRepo = await createAndInitRepo(
                      mirrorConfig,
                      this.options.verbose,
                    );
                    const currentCopies = await mirrorRepo.fetchSnapshots({
                      options: {
                        ids: [snapshot.id],
                        packageNames: [snapshot.packageName],
                        verbose: this.options.verbose,
                      },
                    });
                    if (currentCopies.length) {
                      data.skipped = true;
                      return task.skip(
                        `Already exists at ${mirrorConfig.name}: ${pkgName} (${id})`,
                      );
                    }
                    if (this.config.minFreeDiskSpace)
                      await mirrorRepo.ensureFreeDiskSpace(
                        mirrorConfig.config,
                        this.config.minFreeDiskSpace,
                      );

                    const sourceRepo = sourceRepoMap.with([
                      snapshot,
                      mirrorConfig,
                    ]);
                    if (sourceRepo.has()) {
                      await sourceRepo.get().copy({
                        mirrorRepositoryConfig: mirrorConfig.config,
                        options: { verbose: this.options.verbose },
                        package: { name: snapshot.packageName },
                        snapshot,
                        onProgress: (p) =>
                          pm.update(p, (d) => (task.output = d)),
                      });
                    } else {
                      await this.copyCrossRepository({
                        mirrorConfig,
                        mirrorRepo,
                        repo,
                        repoConfig,
                        snapshot,
                        onProgress: (p) =>
                          pm.update(p, (d) => (task.output = d)),
                      });
                      sourceRepo.set(mirrorRepo);
                    }
                  },
                });
              }),
            );
          },
        }),
      )
      .exec();
  }
}