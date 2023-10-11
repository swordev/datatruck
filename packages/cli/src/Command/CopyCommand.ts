import { ConfigAction } from "../Action/ConfigAction";
import { CopyAction } from "../Action/CopyAction";
import { DataFormat } from "../utils/DataFormat";
import { errorColumn, resultColumn } from "../utils/cli";
import { duration } from "../utils/date";
import { parseStringList } from "../utils/string";
import { If, Unwrap } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type CopyCommandOptionsType<TResolved = false> = {
  id: If<TResolved, string[]>;
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  repository: string;
  repository2?: If<TResolved, string[]>;
};

export type CopyCommandResult = Unwrap<CopyAction["exec"]>;

export class CopyCommand extends CommandAbstract<
  CopyCommandOptionsType<false>,
  CopyCommandOptionsType<true>
> {
  override onOptions() {
    return this.returnsOptions({
      id: {
        option: "-i,--id <ids>",
        description: "Filter by identifiers",
        required: true,
        parser: parseStringList,
      },
      package: {
        option: "-p,--package <names>",
        description: "Filter by package names",
        parser: parseStringList,
      },
      packageTask: {
        option: "-pt,--package-task <values>",
        description: "Filter by task names",
        parser: parseStringList,
      },
      repository: {
        option: "-r,--repository <name>",
        description: "Filter by repository name",
        required: true,
      },
      repository2: {
        option: "-r2,--repository2 <names>",
        description: "Filter by repository names",
        parser: parseStringList,
      },
    });
  }
  override async onExec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const copy = new CopyAction(config, {
      ids: this.options.id,
      packageNames: this.options.package,
      packageTaskNames: this.options.packageTask,
      repositoryName: this.options.repository,
      repositoryNames2: this.options.repository2,
      verbose: verbose > 0,
      tty: this.globalOptions.tty,
      progress: this.globalOptions.progress,
      progressInterval: this.globalOptions.progressInterval,
    });

    const result = await copy.exec();

    if (this.globalOptions.outputFormat)
      copy
        .dataFormat(result, { streams: this.streams, verbose })
        .log(this.globalOptions.outputFormat);

    return result.some((item) => item.error) ? 1 : 0;
  }
}
