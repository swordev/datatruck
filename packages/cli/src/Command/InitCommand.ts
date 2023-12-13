import { ConfigAction } from "../Action/ConfigAction";
import { InitAction } from "../Action/InitAction";
import { RepositoryConfig } from "../Config/RepositoryConfig";
import { DataFormat } from "../utils/DataFormat";
import { renderError, renderResult } from "../utils/cli";
import { parseStringList } from "../utils/string";
import { If, Unwrap } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type InitCommandOptions<TResolved = false> = {
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfig["type"][]>;
};

export type InitCommandResult = Unwrap<InitAction["exec"]>;

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
    const response: InitCommandResult = await init.exec();
    const dataFormat = new DataFormat({
      streams: this.streams,
      json: response,
      table: {
        headers: [
          { value: "", width: 3 },
          { value: "Repository name" },
          { value: "Repository type" },
          { value: "Repository source" },
          { value: "Error", width: 50 },
        ],
        rows: () =>
          response.map((item) => [
            renderResult(item.error),
            item.repositoryName,
            item.repositoryType,
            item.repositorySource,
            renderError(item.error, verbose),
          ]),
      },
    });

    if (this.globalOptions.outputFormat)
      dataFormat.log(this.globalOptions.outputFormat);

    return 0;
  }
}
