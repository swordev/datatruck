import { ConfigAction } from "../Action/ConfigAction";
import { RepositoryConfigType } from "../Config/RepositoryConfig";
import { DataFormat } from "../utils/DataFormat";
import { filterPackages } from "../utils/datatruck/config";
import { parseStringList } from "../utils/string";
import { If } from "../utils/ts";
import { CommandAbstract } from "./CommandAbstract";

export type ConfigCommandOptions<TResolved = false> = {
  package?: If<TResolved, string[]>;
  packageTask?: If<TResolved, string[]>;
  repository?: If<TResolved, string[]>;
  repositoryType?: If<TResolved, RepositoryConfigType["type"][]>;
};

export type ConfigCommandLogType = {
  packageName: string;
  repositoryNames: string[];
  taskName: string | undefined;
}[];

export class ConfigCommand extends CommandAbstract<
  ConfigCommandOptions<false>,
  ConfigCommandOptions<true>
> {
  override onOptions() {
    return this.returnsOptions({
      package: {
        description: "Filter by package names",
        option: "-p,--package <values>",
        parser: parseStringList,
      },
      packageTask: {
        description: "Filter by package task names",
        option: "-pt,--package-task <values>",
        parser: parseStringList,
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
      packageName: pkg.name,
      repositoryNames: pkg.repositoryNames ?? [],
      taskName: pkg.task?.name,
    }));

    const dataFormat = new DataFormat({
      items: summaryConfig,
      table: {
        labels: ["Package", "Repository", "Task"],
        handler: (item) => [
          item.packageName,
          item.repositoryNames.join(", "),
          item.taskName ?? "",
        ],
      },
    });

    if (this.globalOptions.outputFormat)
      console.info(
        dataFormat.format(this.globalOptions.outputFormat, {
          tpl: {
            pkgNames: () => summaryConfig.map((i) => i.packageName).join(),
          },
        }),
      );

    return 0;
  }
}
