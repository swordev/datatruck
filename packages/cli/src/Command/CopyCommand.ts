import { ConfigAction } from "../Action/ConfigAction";
import { CopyAction } from "../Action/CopyAction";
import { parseStringList } from "../utils/string";
import { If, Unwrap } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";
import { JSONSchema7 } from "json-schema";

export type CopyCommandOptionsType<TResolved = false> = {
  id?: If<TResolved, string[]>;
  last?: number;
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  repository: string;
  repository2?: If<TResolved, string[]>;
};

export const copyCommandOptionsDef = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    last: { type: "integer" },
    package: { type: "string" },
    packageTask: { type: "string" },
    repository: { type: "string" },
    repository2: { type: "string" },
  },
} satisfies JSONSchema7;

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
  override async onExec() {
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

    return result.some((item) => item.error) ? 1 : 0;
  }
}
