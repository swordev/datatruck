import type { ConfigType } from "../Config/Config";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { createRepo } from "../Factory/RepositoryFactory";
import { Snapshot } from "../Repository/RepositoryAbstract";
import { DataFormat } from "../utils/DataFormat";
import { errorColumn, resultColumn } from "../utils/cli";
import {
  ensureSameRepositoryType,
  filterRepository,
  findRepositoryOrFail,
} from "../utils/datatruck/config";
import { duration } from "../utils/date";
import { Listr3, Listr3TaskResultEnd } from "../utils/list";
import { ProgressManager } from "../utils/progress";
import { Streams } from "../utils/stream";
import { ensureFreeDiskTempSpace } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import chalk from "chalk";
import { ListrTask } from "listr2";

export type CopyActionOptionsType = {
  ids: string[];
  repositoryName: string;
  packageNames?: string[];
  packageTaskNames?: string[];
  repositoryNames2?: string[];
  verbose?: boolean;
  tty?: "auto" | boolean;
  progress?: "auto" | "interval" | boolean;
  progressInterval?: number;
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
  };
};

export class CopyAction<TRequired extends boolean = true> {
  constructor(
    readonly config: ConfigType,
    readonly options: IfRequireKeys<TRequired, CopyActionOptionsType>,
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
    ) => {
      const g = (v: string) => (color ? `${chalk.gray(`(${v})`)}` : `(${v})`);
      return item.key === "snapshots"
        ? item.data.snapshots.length
        : item.key === "copy"
        ? `${item.data.packageName} ${g(item.data.mirrorRepositoryName)}`
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
            resultColumn(item.error),
            renderTitle(item, true),
            renderData(item, true),
            duration(item.elapsed),
            errorColumn(item.error, options.verbose),
          ]),
      },
    });
  }
  async exec() {
    const { options } = this;
    const pm = new ProgressManager({
      verbose: options.verbose,
      tty: options.tty,
      enabled: options.progress,
      interval: options.progressInterval,
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
            const sourceRepoConfig = findRepositoryOrFail(
              this.config,
              this.options.repositoryName,
            );
            const repo = createRepo(sourceRepoConfig);
            const snapshots = await repo.fetchSnapshots({
              options: {
                ids: this.options.ids,
                packageNames: this.options.packageNames,
                packageTaskNames: this.options.packageTaskNames,
              },
            });
            data.snapshots = snapshots;
            task.title = `Snapshots fetched: ${snapshots.length}`;
            if (!snapshots.length) throw new Error("No snapshots found");

            const repositoryNames2 =
              this.options.repositoryNames2 ||
              this.config.repositories
                .filter(
                  (r) =>
                    r.name !== sourceRepoConfig.name &&
                    r.type === sourceRepoConfig.type &&
                    filterRepository(r, "backup"),
                )
                .map((r) => r.name);

            if (!repositoryNames2.length)
              throw new Error("No mirror snapshots found");

            return snapshots.flatMap((snapshot) =>
              repositoryNames2.map((repo2) =>
                l.$task({
                  key: "copy",
                  keyIndex: [snapshot.packageName, repo2],
                  data: {
                    snapshotId: snapshot.id,
                    packageName: snapshot.packageName,
                    repositoryName: sourceRepoConfig.name,
                    mirrorRepositoryName: repo2,
                  },
                  title: {
                    initial: `Copy snapshot: ${repo2}`,
                    started: `Copying snapshot: ${repo2}`,
                    completed: `Snapshot copied: ${repo2}`,
                    failed: `Snapshot copy failed: ${repo2}`,
                  },
                  exitOnError: false,
                  run: async (task) => {
                    const mirrorConfig = findRepositoryOrFail(
                      this.config,
                      repo2,
                    );
                    const mirrorRepo = createRepo(mirrorConfig);
                    ensureSameRepositoryType(sourceRepoConfig, mirrorConfig);
                    const currentCopies = await mirrorRepo.fetchSnapshots({
                      options: {
                        ids: [snapshot.id],
                        packageNames: [snapshot.packageName],
                      },
                    });
                    if (currentCopies.length)
                      return task.skip(
                        `Already exists at ${mirrorConfig.name}`,
                      );
                    if (this.config.minFreeDiskSpace)
                      await mirrorRepo.ensureFreeDiskSpace(
                        mirrorConfig.config,
                        this.config.minFreeDiskSpace,
                      );

                    await repo.copy({
                      mirrorRepositoryConfig: mirrorConfig.config,
                      options: { verbose: this.options.verbose },
                      package: { name: snapshot.packageName },
                      snapshot,
                      onProgress: (p) => pm.update(p, (d) => (task.output = d)),
                    });
                  },
                }),
              ),
            );
          },
        }),
      )
      .exec();
  }
}
