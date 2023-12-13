import { ConfigAction } from "./Action/ConfigAction";
import { GlobalOptions } from "./Command/CommandAbstract";
import { AppError } from "./Error/AppError";
import {
  DatatruckCommandMap,
  InferDatatruckCommandOptions,
  createCommand,
} from "./Factory/CommandFactory";
import globalData from "./globalData";
import { DataFormatType } from "./utils/DataFormat";
import { OptionsConfig, showCursorCommand } from "./utils/cli";
import { onExit } from "./utils/exit";
import { parsePackageFile } from "./utils/fs";
import { snakeCase } from "./utils/string";
import { sessionTmpDir } from "./utils/temp";
import { red } from "chalk";
import { Command } from "commander";
import { rmSync } from "fs";
import { dirname, isAbsolute, join, sep } from "path";

function getGlobalOptions() {
  const result = program.opts() as Omit<GlobalOptions<false>, "config"> & {
    config: string;
  };
  const parseBool = <T>(v: T): Exclude<T, "true" | "false"> | boolean =>
    v === "true" ? true : v === "false" ? false : (v as any);
  return {
    ...result,
    tty: parseBool(result.tty),
    progress: parseBool(result.progress),
  } as Omit<GlobalOptions<true>, "config"> & {
    config: string;
  };
}

function makeCommand(command: keyof DatatruckCommandMap) {
  const programCommand = program.command(command);

  const instance = createCommand(command, getGlobalOptions(), null as any);
  const options = instance.optionsConfig() as OptionsConfig<any, any>;

  for (const key in options) {
    const option = options[key];
    const description = `${option.description}${
      option.defaults ? ` (defaults: ${option.defaults})` : ""
    }`;
    if (option.required) {
      programCommand.requiredOption(option.option, description);
    } else {
      programCommand.option(option.option, description);
    }
  }

  return programCommand.action(makeCommandAction(command));
}

function makeCommandAction<T>(command: keyof DatatruckCommandMap) {
  return async function (options: T) {
    let exitCode = 1;
    const globalOptions = getGlobalOptions();
    try {
      const configAction = new ConfigAction({
        path: globalOptions.config,
        verbose: !!globalOptions.verbose,
      });
      const config = await configAction.exec();

      if (config.data.tempDir)
        globalData.tempDir = isAbsolute(config.data.tempDir)
          ? config.data.tempDir
          : join(dirname(config.path), config.data.tempDir);

      const response = await createCommand(
        command,
        {
          ...globalOptions,
          config: config.data,
        },
        options as any,
        {},
        globalOptions.config,
      ).exec();

      exitCode = response.exitCode;
    } catch (e) {
      const error = e as Error;
      if (globalOptions.verbose) {
        console.error(red(error.stack));
      } else {
        if (error instanceof AppError) {
          console.error(red(error.message));
        } else {
          console.error(red(error.stack));
        }
      }
    }
    process.stdout.write("", () => process.exit(exitCode));
  };
}

const program = new Command();
const { version, description } = parsePackageFile();
const cwd = process.cwd();

program.name("datatruck");
program.version(version);
program.description(description);
program.usage("dtt");

program.option("-v,--verbose", "Verbose", (_, previous) => previous + 1, 0);
program.option(
  "-c,--config <path>",
  "Config path",
  process.env["DATATRUCK_CONFIG"] ?? (cwd.endsWith(sep) ? cwd : `${cwd}${sep}`),
);
program.option("--tty <value>", "TTY mode (auto, true, false)", "auto");
program.option(
  "--progress <value>",
  "Progress type (auto, true, false, interval, interval:[ms])",
  "auto",
);
program.option(
  "-o,--output-format <format>",
  "Output format (json, pjson, yaml, table, custom=$, tpl=name)",
  "table" as DataFormatType,
);

makeCommand("startServer").alias("start");
makeCommand("config").alias("c");
makeCommand("init").alias("i");
makeCommand("snapshots").alias("s");
makeCommand("prune").alias("p");
makeCommand("backup").alias("b");
makeCommand("restore").alias("r");
makeCommand("copy").alias("cp");
makeCommand("cleanCache").alias("cc");

export function buildArgs<T extends keyof DatatruckCommandMap>(
  input: T,
  options: InferDatatruckCommandOptions<T>,
) {
  const optionsArray = Object.keys(options).flatMap((name) => [
    `--${snakeCase(name, "-")}`,
    options[name as keyof typeof options] as any,
  ]);
  return [input, ...optionsArray];
}

export function parseArgs(args: string[]) {
  program.parse(args);
  const verbose = getGlobalOptions().verbose;
  onExit((eventName, error) => {
    if (eventName !== "exit") {
      process.stdout.write(showCursorCommand);
      console.info(`\nClosing... (reason: ${eventName})`);
      if (error instanceof Error) console.error(red(error.stack));
    }

    if (!verbose)
      try {
        rmSync(sessionTmpDir(), {
          force: true,
          recursive: true,
          maxRetries: 5,
        });
      } catch (error) {}
    if (eventName !== "exit") process.exit(1);
  });
}

export async function exec<T extends keyof DatatruckCommandMap>(
  input: T,
  options: InferDatatruckCommandOptions<T>,
) {
  const argv = buildArgs(input, options);
  return parseArgs(argv);
}
