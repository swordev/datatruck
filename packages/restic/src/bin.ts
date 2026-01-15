import { Backup, BackupRunOptions } from "./actions/backup.js";
import { Copy, CopyRunOptions } from "./actions/copy.js";
import { Init, InitOptions } from "./actions/init.js";
import { GlobalConfig, parseConfigFile } from "./config.js";
import { parseStringList } from "@datatruck/cli/utils/string.js";
import { program } from "commander";
import { resolve } from "path";

function getGlobalOptions() {
  const options = program.opts() as GlobalConfig;
  return {
    ...options,
    config: resolve(options.config!),
    verbose: process.env.DEBUG ? true : options.verbose,
  };
}

async function load() {
  const globalOptions = getGlobalOptions();
  const config = await parseConfigFile(globalOptions.config);
  return { globalOptions, config };
}

program
  .option("-v, --verbose")
  .option(
    "-c, --config <path>",
    "Path to config file",
    "datatruck.restic.json",
  );

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
  .action(async (options: BackupRunOptions) => {
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
  .action(async (options: CopyRunOptions) => {
    const { config, globalOptions } = await load();
    const copy = new Copy(config, globalOptions);
    await copy.run(options);
  });

program.parse();
