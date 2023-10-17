import chalk from "chalk";
import { cyan, grey } from "chalk";
import { createInterface } from "readline";

export const showCursorCommand = "\u001B[?25h";

export function renderProgressBar(
  progress: number,
  size = 10,
  subprogress?: number,
) {
  if (progress > 100) throw new Error(`Invalid progress value: ${progress}`);
  const completeChar = "\u2588";
  const incompleteChar = "\u2591";
  const completedSize = Math.round((progress * size) / 100);
  const restSize = Math.max(size - completedSize, 0);
  let result =
    completeChar.repeat(completedSize) + incompleteChar.repeat(restSize);

  if (typeof subprogress === "number") {
    const subprogressChar = Math.round((subprogress * size) / 100);

    if (subprogressChar === size) {
      result =
        result.slice(0, subprogressChar - 1) +
        chalk.white(result[Math.max(0, subprogressChar - 1)]);
    } else {
      result =
        result.slice(0, subprogressChar) +
        chalk.white(result[Math.max(0, subprogressChar - 1)]) +
        result.slice(subprogressChar + 1);
    }
  }

  return cyan(result);
}

export function logExec(
  command: string,
  argv: string[] = [],
  env?: NodeJS.ProcessEnv,
  logToStderr?: boolean,
) {
  const envText = env
    ? Object.keys(env)
        .reduce((items, key) => {
          items.push(
            `${chalk.cyan(key)}${chalk.grey("=")}${chalk.white(
              env[key] ?? "",
            )}`,
          );
          return items;
        }, [] as string[])
        .join(" ")
    : "";

  const text = `+ ${envText ? envText + " " : ""}${chalk.yellow(
    `${command} ${argv.join(" ")}`,
  )}`;

  logToStderr /* && process.env.VITEST !== "true"*/
    ? process.stderr.write(`${text}\n`)
    : console.info(text);
}

export function resultColumn(
  error: Error | null | string | boolean | undefined,
  color = true,
) {
  return error
    ? color
      ? chalk.red("Χ")
      : "Χ"
    : color
    ? chalk.green("✓")
    : "✓";
}

export function errorColumn(
  error: Error | null | string | undefined,
  verbose?: number,
) {
  let message: string | null = null;
  if (typeof error === "string") {
    message = error;
  } else if (error) {
    message = error.message;
  } else {
    return "";
  }
  if (!verbose) {
    message = message.split(/\r?\n/).shift() ?? "";
  }
  return chalk.red(message.trim());
}

export function renderObject(object: Record<string, any>) {
  const values: string[] = [];
  for (const key in object) values.push(`${key}: ${grey(object[key])}`);
  return values.join(` `);
}

export type OptionsType<T1, T2 extends { [K in keyof T1]: unknown }> = {
  [K in keyof Required<T1>]: {
    option: string;
    description: string;
    required?: boolean;
    defaults?: Exclude<T1[K], undefined>;
    parser?: (value: Exclude<T1[K], undefined>) => Exclude<T2[K], undefined>;
  };
};

export function parseOptions<T1, T2 extends { [K in keyof T1]: unknown }>(
  object: T1,
  options: OptionsType<T1, T2>,
) {
  const result: T2 = {} as any;
  for (const key in options) {
    const isNegative = options[key].option.startsWith("--no");
    const defaultsValue = isNegative ? true : options[key].defaults;
    const value = object?.[key] ?? defaultsValue;
    const parser = options[key].parser;
    if (typeof value !== "undefined") {
      result[key] = parser ? parser(value as any) : (value as any);
    }
  }
  return result;
}

export function confirm(message: string) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let result: boolean = false;

  return new Promise((resolve) => {
    rl.question(
      `${cyan("?")} ${message} ${grey("(y/N)")}: `,
      function (answer) {
        result = /^\s*y(es)?\s*$/i.test(answer);
        rl.close();
      },
    );
    rl.on("close", () => {
      resolve(result);
    });
  });
}
