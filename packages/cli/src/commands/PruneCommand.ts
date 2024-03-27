import { ConfigAction } from "../actions/ConfigAction";
import { PruneAction, pruneActionOptions } from "../actions/PruneAction";
import { confirm } from "../utils/cli";
import { DataFormat } from "../utils/data-format";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const pruneCommandOptions = {
  ...pruneActionOptions,
  longId: {
    description: "Show long snapshot id",
    option: "--longId",
    boolean: true,
  },
  confirm: {
    description: "Confirm action",
    option: "--confirm",
    boolean: true,
  },
} satisfies OptionsConfig;

export type PruneCommandOptions = InferOptions<typeof pruneCommandOptions>;

export class PruneCommand extends CommandAbstract<typeof pruneCommandOptions> {
  static override config() {
    return {
      name: "prune",
      alias: "p",
      options: pruneCommandOptions,
    };
  }
  override get optionsConfig() {
    return pruneCommandOptions;
  }
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);

    const prune = new PruneAction(config, {
      ids: this.options.ids,
      packageNames: this.options.packageNames,
      repositoryNames: this.options.repositoryNames,
      repositoryTypes: this.options.repositoryTypes,
      verbose: verbose > 0,
      dryRun: this.options.dryRun || !this.options.confirm,
      groupBy: this.options.groupBy,
      keepLast: this.options.keepLast,
      keepMinutely: this.options.keepMinutely,
      keepHourly: this.options.keepHourly,
      keepDaily: this.options.keepDaily,
      keepMonthly: this.options.keepMonthly,
      keepWeekly: this.options.keepWeekly,
      keepYearly: this.options.keepYearly,
      tags: this.options.tags,
      showAll: this.options.showAll,
    });

    const result = await prune.exec();
    const dataFormat = new DataFormat({
      streams: this.streams,
      json: result,
      table: {
        headers: [
          { value: "Id.", width: (this.options.longId ? 32 : 8) + 2 },
          { value: "Date", width: 23 + 2 },
          { value: "Package" },
          { value: "Repository" },
          { value: "Repository type" },
          { value: "Exclusion reasons" },
        ],
        rows: () =>
          result.snapshots.map((item) => [
            this.options.longId ? item.id : item.id.slice(0, 8),
            item.date.replace("T", " ").replace("Z", ""),
            item.packageName,
            item.repositoryName,
            item.repositoryType,
            item.exclusionReasons?.join(", ") ?? "",
          ]),
      },
    });

    if (this.globalOptions.outputFormat)
      dataFormat.log(this.globalOptions.outputFormat);

    if (!this.options.confirm && !this.options.dryRun) {
      const answer = await confirm(
        `Delete ${result.prune}/${result.total} snapshots?`,
      );
      if (answer) await prune.confirm(result.snapshots);
    }

    return { result, exitCode: 0 };
  }
}
