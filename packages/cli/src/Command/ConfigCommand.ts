import { ConfigAction } from "../Action/ConfigAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { DataFormat } from "../util/DataFormat";
import { filterPackages } from "../util/datatruck/config-util";
import { parseStringList } from "../util/string-util";
import { If } from "../util/ts-util";
import { CommandAbstract } from "./CommandAbstract";

export type ConfigCommandOptionsType<TResolved = false> = {
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
};

export type ConfigCommandLogType = {
  package: string;
  repositoryNames: string[];
  taskName: string | undefined;
}[];

export class ConfigCommand extends CommandAbstract<
  ConfigCommandOptionsType<false>,
  ConfigCommandOptionsType<true>
> {
  override onOptions() {
    return this.returnsOptions({
      package: {
        description: "Package names",
        option: "-p,--package <values>",
        parser: parseStringList,
      },
      packageTask: {
        description: "Package task names",
        option: "-pt,--package-task <values>",
        parser: parseStringList,
      },
      repository: {
        description: "Repository names",
        option: "-r,--repository <values>",
        parser: parseStringList,
      },
      repositoryType: {
        description: "Repository types",
        option: "-rt,--repository-type <values>",
        parser: (v) => parseStringList(v) as any,
      },
    });
  }
  override async onExec() {
    const config = await ConfigAction.fromGlobalOptions(this.globalOptions);

    const packages = filterPackages(config, {
      packageNames: this.options.package,
      packageTaskNames: this.options.packageTask,
      repositoryNames: this.options.repository,
      repositoryTypes: this.options.repositoryType,
    });

    const summaryConfig: ConfigCommandLogType = packages.flatMap((pkg) => ({
      package: pkg.name,
      repositoryNames: pkg.repositoryNames ?? [],
      taskName: pkg.task?.name,
    }));

    const dataFormat = new DataFormat({
      items: summaryConfig,
      table: {
        labels: ["Package", "Repository", "Task"],
        handler: (item) => [
          item.package,
          item.repositoryNames.join(", "),
          item.taskName ?? "",
        ],
      },
    });

    if (this.globalOptions.outputFormat)
      console.log(dataFormat.format(this.globalOptions.outputFormat));

    return 0;
  }
}
