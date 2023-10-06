import { ConfigAction } from "../Action/ConfigAction";
import { InitAction } from "../Action/InitAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { DataFormat } from "../utils/DataFormat";
import { errorColumn, resultColumn } from "../utils/cli";
import { getErrorProperties } from "../utils/object";
import { parseStringList } from "../utils/string";
import { If, Unwrap } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type InitCommandOptions<TResolved = false> = {
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
};

export type InitCommandLogType = Unwrap<InitAction["exec"]>;

export class InitCommand extends CommandAbstract<
  InitCommandOptions<false>,
  InitCommandOptions<true>
> {
  override onOptions() {
    return this.returnsOptions({
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
    });
  }
  override async onExec() {
    const verbose = this.globalOptions.verbose ?? 0;
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);
    const init = new InitAction(config, {
      repositoryNames: this.options.repository,
      repositoryTypes: this.options.repositoryType,
      verbose: verbose > 0,
    });
    const response: InitCommandLogType = await init.exec();
    const dataFormat = new DataFormat({
      items: response,
      json: (item) => ({
        ...item,
        error: item.error ? getErrorProperties(item.error) : null,
      }),
      table: {
        labels: [
          "   ",
          "Repository name",
          "Repository type",
          "Repository source",
          "",
        ],
        handler: (item) => [
          resultColumn(item.error),
          item.repositoryName,
          item.repositoryType,
          item.repositorySource,
          errorColumn(item.error, verbose),
        ],
      },
    });

    if (this.globalOptions.outputFormat)
      console.info(dataFormat.format(this.globalOptions.outputFormat));

    return 0;
  }
}
