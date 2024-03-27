import { DatatruckRepository } from "../repositories/DatatruckRepository";
import { renderError, renderListTaskItem, renderResult } from "../utils/cli";
import { DataFormat } from "../utils/data-format";
import { findRepositoryOrFail } from "../utils/datatruck/config";
import type { Config } from "../utils/datatruck/config-type";
import {
  createAndInitRepo,
  initSnapshotPath,
} from "../utils/datatruck/repository";
import { duration } from "../utils/date";
import { AppError } from "../utils/error";
import { Listr3, Listr3TaskResultEnd } from "../utils/list";
import { pickProps } from "../utils/object";
import { InferOptions, OptionsConfig } from "../utils/options";
import { Progress, ProgressManager, ProgressMode } from "../utils/progress";
import { StdStreams } from "../utils/stream";
import { GargabeCollector, ensureFreeDiskTempSpace } from "../utils/temp";
import {
  ExtendedSnapshot,
  SnapshotsAction,
  snapshotsActionOptions,
} from "./SnapshotsAction";
import chalk from "chalk";
import { join } from "path";

export const exportActionOptions = {
  id: {
    description: "Filter by snapshot id",
    shortFlag: "i",
    required: true,
  },
  outPath: {
    description: "Out path",
    required: true,
  },
  ...pickProps(snapshotsActionOptions, {
    tags: true,
    packageNames: true,
    packageTaskNames: true,
    packageConfig: true,
    repositoryNames: true,
    repositoryTypes: true,
  }),
} satisfies OptionsConfig;

export type ExportActionOptions = InferOptions<typeof exportActionOptions> & {
  verbose?: boolean;
};

type Context = {
  snapshots: { id: string; packages: number };
  task: { taskName: string; packageName: string };
  export: ExtendedSnapshot;
};

export class ExportAction {
  constructor(
    readonly config: Config,
    readonly options: ExportActionOptions,
    readonly settings: {
      tty?: "auto" | boolean;
      progress?: ProgressMode;
      streams?: StdStreams;
    },
  ) {}

  protected async restore(data: {
    pkg: { name: string };
    snapshotPath: string;
    snapshot: ExtendedSnapshot;
    onProgress: (progress: Progress) => void;
  }) {
    let { snapshot, snapshotPath, pkg } = data;

    await initSnapshotPath(snapshotPath, this.config.minFreeDiskSpace);

    const repoConfig = findRepositoryOrFail(
      this.config,
      snapshot.repositoryName,
    );
    const repo = await createAndInitRepo(repoConfig, this.options.verbose);

    await repo.restore({
      options: this.options,
      snapshot: data.snapshot,
      package: pkg,
      snapshotPath: snapshotPath,
      packageConfig: undefined,
      onProgress: data.onProgress,
    });
  }
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
      return item.key === "export" && color ? chalk.cyan(title) : title;
    };
    const renderData = (
      item: Listr3TaskResultEnd<Context>,
      color?: boolean,
      result: Listr3TaskResultEnd<Context>[] = [],
    ) => {
      const g = (v: string) => (color ? `${chalk.gray(`(${v})`)}` : `(${v})`);
      return renderListTaskItem(item, color, {
        snapshots: (data) => [
          data.id.slice(0, 8),
          g(`${data.packages} packages`),
        ],
        task: (data) => [data.packageName, g(data.taskName)],
        export: (data) => [data.packageName, g(data.repositoryName)],
        summary: (data) => ({
          errors: data.errors,
          exports: result.filter((r) => !r.error && r.key === "export").length,
        }),
      });
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
            renderError(item.error, options.errors?.indexOf(item.error!)),
          ]),
      },
    });
  }
  async exec() {
    const { options, settings } = this;
    const gc = new GargabeCollector();
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: settings.tty,
      mode: settings.progress,
    });

    const l = new Listr3<Context>({
      streams: settings.streams,
      progressManager: pm,
      gargabeCollector: gc,
    });

    return l
      .add(
        l.$task({
          key: "snapshots",
          data: {
            id: "",
            packages: 0,
          },
          title: {
            initial: "Fetch snapshots",
            started: "Fetching snapshots",
            completed: "Snapshots fetched",
            failed: "Snapshot fetch failed",
          },
          run: async (_, data) => {
            const { minFreeDiskSpace } = this.config;
            if (minFreeDiskSpace)
              await ensureFreeDiskTempSpace(minFreeDiskSpace);
            if (!options.id) throw new AppError("Snapshot id is required");

            const snapshots = await new SnapshotsAction(this.config, {
              ids: [this.options.id],
              repositoryNames: this.options.repositoryNames,
              repositoryTypes: this.options.repositoryTypes,
              packageNames: this.options.packageNames,
              packageTaskNames: this.options.packageTaskNames,
              packageConfig: this.options.packageConfig,
              tags: this.options.tags,
              groupBy: ["packageName"],
            }).exec("restore");

            if (!snapshots.length) throw new AppError("None snapshot found");

            data.id = options.id;
            data.packages = snapshots.length;

            return snapshots.map((snapshot) =>
              l.$task({
                key: "export",
                keyIndex: snapshot.packageName,
                data: snapshot,
                title: {
                  initial: `Export snapshot: ${snapshot.packageName} (${snapshot.repositoryName})`,
                  started: `Restoring snapshot: ${snapshot.packageName} (${snapshot.repositoryName})`,
                  completed: `Snapshot exported: ${snapshot.packageName} (${snapshot.repositoryName})`,
                  failed: `Snapshot export failed: ${snapshot.packageName} (${snapshot.repositoryName})`,
                },
                exitOnError: false,
                run: async (listTask) => {
                  using progress = pm.create(listTask);
                  await using _ = gc.create().disposeOnFinish();
                  await this.restore({
                    pkg: { name: snapshot.packageName },
                    snapshotPath: join(
                      this.options.outPath,
                      snapshot.repositoryName,
                      DatatruckRepository.createSnapshotName(snapshot, {
                        name: snapshot.packageName,
                      }),
                    ),
                    snapshot: snapshot,
                    onProgress: progress.update,
                  });
                },
              }),
            );
          },
        }),
      )
      .execAndParse(this.options.verbose);
  }
}
