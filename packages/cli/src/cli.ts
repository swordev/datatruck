import { ConfigAction } from "./actions/ConfigAction";
import { CommandConstructor, GlobalOptions } from "./commands/CommandAbstract";
import globalData from "./globalData";
import { showCursorCommand, waitForStdDrain } from "./utils/cli";
import { DataFormatType } from "./utils/data-format";
import {
  DatatruckCommandMap,
  datatruckCommands,
} from "./utils/datatruck/command";
import { AppError } from "./utils/error";
import { onExit } from "./utils/exit";
import { parsePackageFile } from "./utils/fs";
import { createCommand } from "./utils/options";
import { sessionTmpDir } from "./utils/temp";
import chalk from "chalk";
import { Command } from "commander";
import { rmSync } from "fs";
import { dirname, isAbsolute, join, sep } from "path";
import { format } from "util";

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

function createCommandAction<T extends keyof DatatruckCommandMap>(
  Constructor: CommandConstructor,
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

      const command = new Constructor(
        { ...globalOptions },
        options as any,
        {},
        globalOptions.config,
      );
      const response = await command.exec();
      errors = response.errors;
      exitCode = response.exitCode;
    } catch (e) {
      error = e as Error;
    }

    if (errors?.length) {
      console.error();
      errors.forEach((error, index) => {
        console.error(chalk.red(`${index + 1}. ` + format(error)));
        if (errors![index + 1]) console.error();
      });
    }

    if (error) {
      if (globalOptions.verbose) {
        console.error(chalk.red(format(error)));
      } else {
        if (error instanceof AppError) {
          console.error(chalk.red(error.message));
        } else {
          console.error(chalk.red(format(error)));
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

const Commands = (Object.values(datatruckCommands) as CommandConstructor[])
  .map((Command) => ({ Command, config: Command.config() }))
  .sort((a, b) => a.config.name.localeCompare(b.config.name));

for (const { Command, config } of Commands) {
  program.addCommand(createCommand(config, createCommandAction(Command)));
}

export function parseArgs(args: string[]) {
  program.parse(args);
  const verbose = getGlobalOptions().verbose;
  onExit((eventName, error) => {
    if (eventName !== "exit") {
      process.stdout.write(showCursorCommand);
      console.info(`\nClosing... (reason: ${eventName})`);
      if (error instanceof Error) console.error(format(error));
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
