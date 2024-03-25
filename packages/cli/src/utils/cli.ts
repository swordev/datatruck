import { AppError } from "./error";
import { Listr3TaskResultEnd } from "./list";
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

export function renderResult(
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

export function renderError(
  error: Error | null | string | undefined,
  verbose?: number,
) {
  if (!error) {
    return "";
  } else if (error instanceof AppError) {
    return chalk.red(verbose ? error.stack ?? error.message : error.message);
  } else if (error instanceof Error) {
    return chalk.red(error.stack ?? error.message);
  } else {
    const message = error.split(/\r?\n/).shift() ?? "";
    return chalk.red(message.trim());
  }
}

export function renderListTaskItem<T extends Record<string, any>>(
  item: Listr3TaskResultEnd<T>,
  color: boolean | undefined,
  config: {
    [K in Listr3TaskResultEnd<T>["key"]]: (
      data: Extract<Listr3TaskResultEnd<T>, { key: K }>["data"],
    ) => string | number | string[] | Record<string, string | number>;
  },
) {
  const result = config[item.key]?.(item.data as any);
  if (typeof result === "string" || typeof result === "number") {
    return result.toString();
  } else if (Array.isArray(result)) {
    return result.join(" ");
  } else if (typeof result === "object" && !!result) {
    return renderObject(result, color);
  } else {
    return "";
  }
}

export function renderObject(object: Record<string, any>, color?: boolean) {
  const values: string[] = [];
  for (const key in object)
    values.push(`${key}: ${color ? grey(object[key]) : object[key]}`);
  return values.join(` `);
}

export type OptionsConfig<T1, T2 extends { [K in keyof T1]: unknown }> = {
  [K in keyof Required<T1>]: {
    option?: string;
    description: string;
    required?: boolean;
    defaults?: Exclude<T1[K], undefined>;
    parser?: (value: Exclude<T1[K], undefined>) => Exclude<T2[K], undefined>;
  };
};

export function parseOptions<T1, T2 extends { [K in keyof T1]: unknown }>(
  object: T1,
  options: OptionsConfig<T1, T2>,
) {
  const result: T2 = {} as any;
  for (const key in options) {
    const opt = options[key].option;
    let defaultsValue: any;
    let parser = options[key].parser;
    if (typeof opt === "string") {
      const isNegative = opt.startsWith("--no");
      defaultsValue = isNegative ? true : options[key].defaults;
    }
    const value = object?.[key] ?? defaultsValue;
    if (typeof value !== "undefined") {
      result[key] = parser ? parser(value as any) : (value as any);
    }
  }
  return result;
}

export function stringifyOptions<T1, T2 extends { [K in keyof T1]: unknown }>(
  options: OptionsConfig<T1, T2>,
  object: any,
) {
  const result: string[] = [];
  const prepend: string[] = [];
  for (const key in options) {
    const fullOpt = options[key].option;
    if (typeof fullOpt === "string") {
      const [opt] = fullOpt.split(",");
      const isNegative = fullOpt.startsWith("--no");
      const isBool = !fullOpt.includes("<") && !fullOpt.includes("[");
      const defaultsValue = isNegative ? true : options[key].defaults;
      const value = object?.[key] ?? defaultsValue;

      if (isBool) {
        if (object[key]) result.push(opt);
      } else if (value !== undefined) {
        result.push(opt, `${value}`);
      }
    } else {
      const value = object?.[key];
      if (value !== undefined) prepend.push(value);
    }
  }
  return [...prepend, ...result];
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

export async function waitForStdDrain(ms?: number) {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) =>
        new Promise<void>((resolve) => {
          {
            const finish = () => {
              clearTimeout(timeout);
              resolve();
            };
            const timeout = ms ? setTimeout(finish, ms) : undefined;
            const drained = stream.write("", finish);
            if (drained) finish();
          }
        }),
    ),
  );
}

export function colorizeValue(
  value: unknown,
  color?: typeof chalk.ForegroundColor,
) {
  const json = JSON.stringify(value);
  return color ? chalk[color](json) : json;
}

export function colorizeObject(input: Record<string, any>) {
  const object: Record<string, string> = {};

  for (const key in input) {
    const value = input[key];
    if (value !== undefined)
      object[colorizeValue(key)] =
        typeof value === "object" && !!value && !Array.isArray(value)
          ? colorizeObject(value)
          : colorizeValue(value, "green");
  }

  const values = Object.entries(object)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

  return `{ ${values} }`;
}

export function logJson(ctx: string, msg: string, data?: any) {
  const json = colorizeObject({
    ctx,
    msg,
    data,
  });
  console.log(json);
}
