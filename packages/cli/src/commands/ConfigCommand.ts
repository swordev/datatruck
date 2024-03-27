import { ConfigAction } from "../actions/ConfigAction";
import { DataFormat } from "../utils/data-format";
import { filterPackages } from "../utils/datatruck/config";
import type { RepositoryConfig } from "../utils/datatruck/config-type";
import { InferOptions, defineOptionsConfig } from "../utils/options";
import { parseStringList } from "../utils/string";
import { CommandAbstract } from "./CommandAbstract";

export const configCommandOptions = defineOptionsConfig({
  packageNames: {
    description: "Filter by package names",
    option: "-p,--package <values>",
    parser: parseStringList<string>,
  },
  packageTaskNames: {
    description: "Filter by package task names",
    option: "-pt,--package-task <values>",
    parser: parseStringList<string>,
  },
  repositoryNames: {
    description: "Filter by repository names",
    option: "-r,--repository <values>",
    parser: parseStringList<string>,
  },
  repositoryTypes: {
    description: "Filter by repository types",
    option: "-rt,--repository-type <values>",
    parser: (v) => parseStringList<RepositoryConfig["type"]>(v),
  },
});

export type ConfigCommandOptions = InferOptions<typeof configCommandOptions>;

export class ConfigCommand extends CommandAbstract<
  typeof configCommandOptions
> {
  static override config() {
    return {
      name: "config",
      alias: "c",
      options: configCommandOptions,
    };
  }
  override get optionsConfig() {
    return configCommandOptions;
  }
  override async exec() {
    const result = await ConfigAction.fromGlobalOptionsWithPath(
      this.globalOptions,
    );

    const packages = filterPackages(result.data, {
      packageNames: this.options.packageNames,
      packageTaskNames: this.options.packageTaskNames,
      repositoryNames: this.options.repositoryNames,
      repositoryTypes: this.options.repositoryTypes,
    });

    const summaryConfig = packages.flatMap((pkg) => ({
      packageName: pkg.name,
      repositoryNames: pkg.repositoryNames ?? [],
      taskName: pkg.task?.name,
    }));

    const dataFormat = new DataFormat({
      streams: this.streams,
      json: result,
      table: {
        headers: [
          { value: "Package" },
          { value: "Repository" },
          { value: "Task" },
        ],
        rows: () =>
          summaryConfig.map((item) => [
            item.packageName,
            item.repositoryNames.join(", "),
            item.taskName ?? "",
          ]),
      },
    });

    if (this.globalOptions.outputFormat)
      dataFormat.log(this.globalOptions.outputFormat, {
        tpl: {
          pkgNames: () => summaryConfig.map((i) => i.packageName).join(),
        },
      });

    return { result, exitCode: 0 };
  }
}
