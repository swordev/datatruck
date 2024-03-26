import { ConfigAction } from "./actions/ConfigAction";
import { CommandAbstract, GlobalOptions } from "./commands/CommandAbstract";
import globalData from "./globalData";
import { OptionsConfig, showCursorCommand, waitForStdDrain } from "./utils/cli";
import { DataFormatType } from "./utils/data-format";
import {
  DatatruckCommandMap,
  InferDatatruckCommandOptions,
  createCommand,
} from "./utils/datatruck/command";
import { AppError } from "./utils/error";
import { onExit } from "./utils/exit";
import { parsePackageFile } from "./utils/fs";
import { snakeCase } from "./utils/string";
import { sessionTmpDir } from "./utils/temp";
import chalk, { red } from "chalk";
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
  const instance = createCommand(command, getGlobalOptions(), null as any);
  const options = instance.optionsConfig() as OptionsConfig<any, any>;
  const inlineOptions: { name: string; required?: boolean }[] = [];

  for (const name in options) {
    const option = options[name];
    if (typeof option.option !== "string") {
      inlineOptions.push({ name, required: option.required });
    }
  }

  const programCommand = program.command(
    [
      command,
      ...inlineOptions.map((v) => (v.required ? `<${v.name}>` : `[${v.name}]`)),
    ].join(" "),
  );

  for (const key in options) {
    const option = options[key];
    if (typeof option.option === "string") {
      const description = `${option.description}${
        option.defaults ? ` (defaults: ${option.defaults})` : ""
      }`;
      if (option.required) {
        programCommand.requiredOption(option.option, description);
      } else {
        programCommand.option(option.option, description);
      }
    }
  }

  return programCommand.action(async (...args: any[]) => {
    const inlineValues = args.slice(0, inlineOptions.length);
    const action = makeCommandAction(command);
    const inOptions = args[inlineOptions.length] || {};
    const options = inlineOptions.reduce((result, inlineOption, index) => {
      const value = inlineValues[index];
      if (value !== undefined) result[inlineOption.name] = value;
      return result;
    }, inOptions);
    return await action(options);
  });
}

function makeCommandAction<T extends keyof DatatruckCommandMap>(
  commandName: T,
) {
  return async function (
    options: InstanceType<DatatruckCommandMap[T]>["options"],
  ) {
    let exitCode = 1;
    let error: Error | undefined;
    let errors: Error[] | undefined;
    const globalOptions = getGlobalOptions();
    try {
      const config =
        await ConfigAction.fromGlobalOptionsWithPath(globalOptions);

      if (config.data.tempDir)
        globalData.tempDir = isAbsolute(config.data.tempDir)
          ? config.data.tempDir
          : join(dirname(config.path!), config.data.tempDir);

      const command = createCommand(
        commandName,
        { ...globalOptions },
        options,
        {},
        globalOptions.config,
      ) as CommandAbstract<{}, {}>;

      const response = await command.exec();
      errors = response.errors;
      exitCode = response.exitCode;
    } catch (e) {
      error = e as Error;
    }

    if (errors?.length) {
      console.error();
      errors.forEach((error, index) => {
        console.error(
          chalk.red(`${index + 1}. ` + error.stack ?? error.message),
        );
        if (errors![index + 1]) console.error();
      });
    }

    if (error) {
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
    await waitForStdDrain(5_000);
    process.exit(exitCode);
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
makeCommand("run");
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
