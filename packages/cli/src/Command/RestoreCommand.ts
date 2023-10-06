import { ConfigAction } from "../Action/ConfigAction";
import { RestoreAction } from "../Action/RestoreAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { parseStringList } from "../utils/string";
import { If } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type RestoreCommandOptionsType<TResolved = false> = {
  id: string;
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  packageConfig?: boolean;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
  tag?: If<TResolved, string[]>;
  restorePath?: boolean;
};

export class RestoreCommand extends CommandAbstract<
  RestoreCommandOptionsType<false>,
  RestoreCommandOptionsType<true>
> {
  override onOptions() {
    return this.returnsOptions({
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
      restorePath: {
        description: "Disable restore path",
        option: "--no-restore-path",
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
  override async onExec() {
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
      restorePath: this.options.restorePath,
      tty: this.globalOptions.tty,
      progress: this.globalOptions.progress,
      progressInterval: this.globalOptions.progressInterval,
    });

    const list = await restore.exec();
    await list.run();
    return list.errors.length ? 1 : 0;
  }
}
