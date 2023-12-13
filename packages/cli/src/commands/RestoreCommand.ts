import { ConfigAction } from "../actions/ConfigAction";
import { RestoreAction } from "../actions/RestoreAction";
import type { RepositoryConfig } from "../utils/datatruck/config-type";
import { parseStringList } from "../utils/string";
import { If } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type RestoreCommandOptions<TResolved = false> = {
  id: string;
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  packageConfig?: boolean;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfig["type"][]>;
  tag?: If<TResolved, string[]>;
  initial?: boolean;
};

export class RestoreCommand extends CommandAbstract<
  RestoreCommandOptions<false>,
  RestoreCommandOptions<true>
> {
  override optionsConfig() {
    return this.castOptionsConfig({
      id: {
        description: "Filter by snapshot id",
        option: "-i,--id <id>",
        required: true,
      },
      package: {
        description: "Filter by package names",
        option: "-p,--package <values>",
        parser: parseStringList,
      },
      initial: {
        description: "Initial restoring (disables restore path)",
        option: "--initial",
      },
      packageTask: {
        description: "Filter by package task names",
        option: "-pt,--package-task <values>",
        parser: parseStringList,
      },
      packageConfig: {
        description: "Filter by package config",
        option: "-pc,--package-config",
      },
      repository: {
        description: "Filter by repository names",
        option: "-r,--repository <values>",
        parser: parseStringList,
      },
      repositoryType: {
        description: "Filter by repository types",
        option: "-rt,--repository-type <values>",
        parser: (v) => parseStringList(v) as any,
      },
      tag: {
        description: "Filter by tags",
        option: "-t,--tag <values>",
        parser: parseStringList,
      },
    });
  }
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const restore = new RestoreAction(config, {
      snapshotId: this.options.id,
      packageNames: this.options.package,
      packageTaskNames: this.options.packageTask,
      packageConfig: this.options.packageConfig,
      repositoryNames: this.options.repository,
      repositoryTypes: this.options.repositoryType,
      tags: this.options.tag,
      verbose: verbose > 0,
      initial: this.options.initial,
      tty: this.globalOptions.tty,
      progress: this.globalOptions.progress,
      streams: this.streams,
    });

    const result = await restore.exec();

    if (this.globalOptions.outputFormat)
      restore
        .dataFormat(result, { streams: this.streams, verbose })
        .log(this.globalOptions.outputFormat);

    const exitCode = result.some((item) => item.error) ? 1 : 0;

    return { result, exitCode };
  }
}
