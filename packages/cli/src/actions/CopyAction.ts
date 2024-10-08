import {
  RepositoryAbstract,
  Snapshot,
} from "../repositories/RepositoryAbstract";
import { formatBytes } from "../utils/bytes";
import { renderError, renderResult, renderListTaskItem } from "../utils/cli";
import { DataFormat, DataFormatType } from "../utils/data-format";
import {
  filterRepository,
  findRepositoryOrFail,
  sortReposByType,
} from "../utils/datatruck/config";
import type { Config, RepositoryConfig } from "../utils/datatruck/config-type";
import {
  ReportListTaskContext,
  createReportListTasks,
} from "../utils/datatruck/report-list";
import { createAndInitRepo } from "../utils/datatruck/repository";
import { groupAndFilter } from "../utils/datatruck/snapshot";
import { duration } from "../utils/date";
import { AppError } from "../utils/error";
import { Listr3, Listr3TaskResultEnd } from "../utils/list";
import { StrictMap, pickProps } from "../utils/object";
import { InferOptions, OptionsConfig } from "../utils/options";
import { Progress, ProgressManager, ProgressMode } from "../utils/progress";
import { StdStreams } from "../utils/stream";
import { parseStringList } from "../utils/string";
import { ensureFreeDiskTempSpace, useTempDir } from "../utils/temp";
import { snapshotsActionOptions } from "./SnapshotsAction";
import chalk from "chalk";
import { hostname } from "os";

export const copyActionOptions = {
  ids: {
    description: "Filter by identifiers",
    shortFlag: "i",
    value: "array",
  },
  last: {
    description: "Last snapshots",
    shortFlag: "l",
    value: "number",
  },
  repositoryName: {
    description: "Filter by repository name",
    shortFlag: "r",
    required: true,
  },
  ...pickProps(snapshotsActionOptions, {
    packageNames: true,
    packageTaskNames: true,
  }),
  repositoryNames2: {
    description: "Filter by repository names",
    shortFlag: "r2",
    value: "array",
  },
} satisfies OptionsConfig;

export type CopyActionOptions = InferOptions<typeof copyActionOptions> & {
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
    bytes: number;
  };
} & ReportListTaskContext;

export class CopyAction {
  constructor(
    readonly config: Config,
    readonly options: CopyActionOptions,
  ) {}
  dataFormat(
    result: Listr3TaskResultEnd<Context>[],
    options: {
      streams?: StdStreams;
      verbose?: number;
      errors?: Error[];
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
      items: Listr3TaskResultEnd<Context>[] = [],
      format: DataFormatType,
    ) => {
      const color = format !== "list";
      const g = (v: string) => (color ? `${chalk.gray(`(${v})`)}` : `(${v})`);
      return renderListTaskItem(item, color, {
        snapshots: (data) => data.snapshots.length,
        copy: (data) => [
          data.packageName,
          g(
            [
              data.snapshotId.slice(0, 8),
              data.mirrorRepositoryName,
              formatBytes(data.bytes),
            ].join(" "),
          ),
        ],
        report: (data) => data.type,
        summary: (data) => ({
          errors: data.errors,
          copied: items.filter(
            (i) => i.key === "copy" && !i.error && !i.data.skipped,
          ).length,
          skipped: items.filter(
            (i) => i.key === "copy" && !i.error && i.data.skipped,
          ).length,
          ...(format === "list" && {
            duration: duration(item.elapsed),
          }),
        }),
      });
    };
    return new DataFormat({
      streams: options.streams,
      json: result,
      list: () =>
        result.map((item) => {
          const icon = renderResult(item.error, false);
          const title = renderTitle(item);
          const data = renderData(item, result, "list");
          return `${icon} ${title}: ${data}`;
        }),
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
            renderData(item, result, "table"),
            duration(item.elapsed),
            renderError(item.error, options.errors?.indexOf(item.error!)),
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

    if (!result.length) throw new AppError("No snapshots found");
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
    const { repo, mirrorRepo, mirrorConfig, snapshot } = options;
    await using tmp = await useTempDir("copy", "restore");
    await repo.restore({
      options: {
        verbose: this.options.verbose,
        id: snapshot.id,
      },
      snapshot: { id: snapshot.id, date: snapshot.date },
      package: { name: snapshot.packageName },
      packageConfig: undefined,
      snapshotPath: tmp.path,
      onProgress: options.onProgress,
    });
    if (this.config.minFreeDiskSpace)
      await mirrorRepo.ensureFreeDiskSpace(
        mirrorConfig.config,
        this.config.minFreeDiskSpace,
      );
    return await mirrorRepo.backup({
      hostname: snapshot.hostname,
      options: {
        verbose: this.options.verbose,
        tags: snapshot.tags,
      },
      snapshot: { id: snapshot.id, date: snapshot.date },
      package: {
        name: snapshot.packageName,
        path: tmp.path,
      },
      packageConfig: undefined,
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
      .add([
        l.$task({
          key: "snapshots",
          data: { snapshots: [] },
          exitOnError: false,
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
              throw new AppError("No mirror snapshots found");

            const sourceRepoMap = this.createSourceRepoMap();

            return [
              ...data.snapshots.flatMap((snapshot) =>
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
                      bytes: 0,
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

                      const sourceRepo = sourceRepoMap.withKey([
                        { id: snapshot.id, packageName: snapshot.packageName },
                        { type: mirrorConfig.type },
                      ]);

                      const $sourceRepo =
                        repoConfig.type === mirrorConfig.type
                          ? repo
                          : sourceRepo.has()
                            ? sourceRepo.get()
                            : undefined;

                      if ($sourceRepo) {
                        using progress = pm.create(task);
                        const copy = await $sourceRepo.copy({
                          mirrorRepositoryConfig: mirrorConfig.config,
                          options: { verbose: this.options.verbose },
                          package: { name: snapshot.packageName },
                          snapshot,
                          onProgress: progress.update,
                        });
                        data.bytes = copy.bytes;
                      } else {
                        using progress = pm.create(task);
                        const copy = await this.copyCrossRepository({
                          mirrorConfig,
                          mirrorRepo,
                          repo,
                          repoConfig,
                          snapshot,
                          onProgress: progress.update,
                        });
                        data.bytes = copy.bytes;
                        sourceRepo.set(mirrorRepo);
                      }
                    },
                  });
                }),
              ),
            ];
          },
        }),
        ...createReportListTasks(l, {
          hostname: this.config.hostname ?? hostname(),
          action: "copy",
          reports: this.config.reports || [],
          verbose: this.options.verbose,
          onMessage: (result, report) =>
            this.dataFormat(result).format(report.format ?? "list"),
        }),
      ])
      .execAndParse(this.options.verbose);
  }
}
