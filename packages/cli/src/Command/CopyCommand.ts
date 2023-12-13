import { ConfigAction } from "../Action/ConfigAction";
import { CopyAction } from "../Action/CopyAction";
import { parseStringList } from "../utils/string";
import { If } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type CopyCommandOptionsType<TResolved = false> = {
  id?: If<TResolved, string[]>;
  last?: number;
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  repository: string;
  repository2?: If<TResolved, string[]>;
};

export class CopyCommand extends CommandAbstract<
  CopyCommandOptionsType<false>,
  CopyCommandOptionsType<true>
> {
  override optionsConfig() {
    return this.castOptionsConfig({
      id: {
        option: "-i,--id <ids>",
        description: "Filter by identifiers",
        parser: parseStringList,
      },
      last: {
        option: "-l,--last <amount>",
        description: "Last snapshots",
        parser: Number,
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
  override async exec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const copy = new CopyAction(config, {
      ids: this.options.id,
      last: this.options.last,
      packageNames: this.options.package,
      packageTaskNames: this.options.packageTask,
      repositoryName: this.options.repository,
      repositoryNames2: this.options.repository2,
      verbose: verbose > 0,
      tty: this.globalOptions.tty,
      progress: this.globalOptions.progress,
    });

    const result = await copy.exec();

    if (this.globalOptions.outputFormat)
      copy
        .dataFormat(result, { streams: this.streams, verbose })
        .log(this.globalOptions.outputFormat);

    const exitCode = result.some((item) => item.error) ? 1 : 0;

    return { result, exitCode };
  }
}
