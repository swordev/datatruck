import { Backup, BackupOptions } from "./actions/backup.js";
import { Copy, CopyOptions } from "./actions/copy.js";
import { Create, CreateOptions } from "./actions/create.js";
import { Init, InitOptions } from "./actions/init.js";
import { Prune, PruneOptions } from "./actions/prune.js";
import { Run } from "./actions/run.js";
import { Config, GlobalConfig, parseConfigFile } from "./config.js";
import { parseStringList } from "@datatruck/cli/utils/string.js";
import { Command } from "commander";
import { resolve } from "path";

export function createBin(inConfig?: Config): Command {
  async function load() {
    const globalOptions = { ...program.opts() } as GlobalConfig;
    if (globalOptions.config)
      globalOptions.config = resolve(globalOptions.config);
    const config = inConfig ?? (await parseConfigFile(globalOptions.config));
    globalOptions.verbose = process.env.DEBUG
      ? true
      : globalOptions.verbose || config.verbose;
    return { config, globalOptions };
  }

  const program = new Command();

  program.option("-v, --verbose");

  if (!inConfig)
    program.option(
      "-c, --config <path>",
      "Path to config file",
      "datatruck.restic.json",
    );

  program
    .command("create")
    .description("Create config file")
    .option(
      "--cwd <path>",
      "Current working directory to create config file in",
      ".",
    )
    .option(
      "-c,--config <path>",
      "Output path for config file",
      "datatruck.restic.json",
    )
    .option("-f,--force", "Force overwrite if config file already exists")
    .action(async (options: CreateOptions) => {
      const create = new Create();
      await create.run(options);
    });

  program
    .command("run")
    .description("Run arbitrary restic command")
    .option("-r, --repository <name>", "Repository name")
    .argument("[args...]", "Restic arguments")
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async (args: string[], options: { repository?: string }) => {
      const { config, globalOptions } = await load();
      if (!options.repository && config.repositories.length !== 1)
        throw new Error("Repository name is required");
      const repository = options.repository ?? config.repositories[0].name;
      const run = new Run(config, globalOptions);
      await run.run({ repository, args });
    });

  program
    .command("init")
    .alias("i")
    .description("Run init action")
    .option("-r, --repositories <names>", "Repository names", (v) =>
      parseStringList(v),
    )
    .action(async (options: InitOptions) => {
      const { config, globalOptions } = await load();
      const init = new Init(config, globalOptions);
      await init.run(options);
    });

  program
    .command("backup")
    .alias("b")
    .description("Run backup action")
    .option("-r, --repositories <names>", "Repository names", (v) =>
      parseStringList(v),
    )
    .option("-p, --packages <packages>", "Package names", (v) =>
      parseStringList(v),
    )
    .option("--prune", "Prune after backup")
    .action(async (options: BackupOptions) => {
      const { config, globalOptions } = await load();
      const backup = new Backup(config, globalOptions);
      await backup.run(options);
    });

  program
    .command("copy")
    .alias("c")
    .description("Run copy action")
    .option("-p, --packages <packages>", "Package names", (v) =>
      parseStringList(v),
    )
    .requiredOption("-s, --source <name>", "Source repository name")
    .requiredOption("-t, --targets <names>", "Target repository names", (v) =>
      parseStringList(v),
    )
    .option("--prune", "Prune after copy")
    .action(async (options: CopyOptions) => {
      const { config, globalOptions } = await load();
      const copy = new Copy(config, globalOptions);
      await copy.run(options);
    });

  program
    .command("prune")
    .alias("p")
    .description("Run prune action")
    .option("-r, --repositories <names>", "Repository names", (v) =>
      parseStringList(v),
    )
    .option("-p, --packages <packages>", "Package names", (v) =>
      parseStringList(v),
    )
    .option("--prune", "Prune after copy")
    .action(async (options: PruneOptions) => {
      const { config, globalOptions } = await load();
      const prune = new Prune(config, globalOptions);
      await prune.run(options);
    });

  const parse = program.parse.bind(program);

  program.parse = function (args, options) {
    if (!args) args = process.argv;
    const [node, script, command, ...rest] = args;
    if (command === "run") {
      const repositoryIndex = rest.findIndex(
        (v) => v === "-r" || v === "--repository",
      );
      if (repositoryIndex !== -1) {
        const repositoryName = rest[repositoryIndex + 1];
        const others = rest.filter(
          (_, i) => i !== repositoryIndex && i !== repositoryIndex + 1,
        );
        args = [node, script, command, "-r", repositoryName, "--", ...others];
      } else {
        args = [node, script, command, "--", ...rest];
      }
    }
    return parse(args, options);
  };

  return program;
}
