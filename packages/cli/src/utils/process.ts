import { logExec } from "./cli";
import chalk from "chalk";
import { Readable, Writable } from "stream";

export type ProcessEnv = {
  [name: string]: string | undefined;
};

export function logStdout(input: {
  data: string;
  colorize?: boolean;
  stderr?: boolean;
  lineSalt?: boolean;
}) {
  let text = input.colorize ? chalk.grey(input.data) : input.data;
  if (input.lineSalt) text += "\n";
  input.stderr ? process.stderr.write(text) : process.stdout.write(text);
}

export function logStderr(data: string, colorize?: boolean) {
  process.stdout.write(colorize ? chalk.red(data) : data);
}

export type LogProcessOptions = {
  envNames?: string[];
  env?: Record<string, any>;
  pipe?: Readable | Writable;
  toStderr?: boolean;
  colorize?: boolean;
};

export async function logProcess(
  command: string,
  argv: any[],
  options: LogProcessOptions,
) {
  const logEnv = options.envNames?.reduce((env, key) => {
    const value = options?.env?.[key];
    if (typeof value !== "undefined") env[key] = value;
    return env;
  }, {} as NodeJS.ProcessEnv);
  logExec(
    command,
    options.pipe
      ? [
          ...argv,
          options.pipe instanceof Readable ? "<" : ">",
          "path" in options.pipe ? String(options.pipe.path) : "[stream]",
        ]
      : argv,
    logEnv,
    options.toStderr,
  );
}
