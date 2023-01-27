import { logExec } from "./cli";
import { checkDir } from "./fs";
import { progressPercent } from "./math";
import chalk from "chalk";
import {
  SpawnOptions,
  spawn,
  ChildProcess,
  ChildProcessByStdio,
} from "child_process";
import { ReadStream, statSync, WriteStream } from "fs";
import { stat } from "fs/promises";
import { createInterface } from "readline";
import { Readable, Writable } from "stream";

export type ExecLogSettingsType = {
  colorize?: boolean;
  exec?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  allToStderr?: boolean;
  envNames?: string[];
};

export interface ExecSettingsInterface {
  exec?: boolean;
  pipe?:
    | {
        stream: WriteStream;
        onWriteProgress?: (data: { totalBytes: number }) => void;
      }
    | {
        stream: ReadStream;
        onReadProgress?: (data: {
          totalBytes: number;
          currentBytes: number;
          progress: number;
        }) => void;
      }
    | {
        stream: Readable;
      };
  log?: ExecLogSettingsType | boolean;
  onSpawn?: (p: ChildProcess) => any;
  stdout?: {
    save?: boolean;
    parseLines?: boolean;
    onData?: (data: string) => void;
  };
  stderr?: {
    save?: boolean;
    onData?: (data: string) => void;
    toExitCode?: boolean;
  };
  onExitCodeError?: (data: ExecResultType, error: Error) => Error | false;
}

export function logExecStdout(input: {
  data: string;
  colorize?: boolean;
  stderr?: boolean;
  lineSalt?: boolean;
}) {
  let text = input.colorize ? chalk.grey(input.data) : input.data;
  if (input.lineSalt) text += "\n";
  input.stderr ? process.stderr.write(text) : process.stdout.write(text);
}

export function logExecStderr(data: string, colorize?: boolean) {
  process.stdout.write(colorize ? chalk.red(data) : data);
}

export type ExecResultType = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type LogProcessOptions = {
  envNames?: string[];
  env?: Record<string, any>;
  pipe?: Readable | Writable;
  toStderr?: boolean;
  colorize?: boolean;
};

export async function logProcessExec(
  command: string,
  argv: any[],
  options: LogProcessOptions
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
    options.toStderr
  );
}
export async function exec(
  command: string,
  argv: string[] = [],
  options: SpawnOptions | null = null,
  settings: ExecSettingsInterface = {}
) {
  const pipe = settings.pipe;
  let log: ExecLogSettingsType = {};
  if (settings.log === true) {
    log.exec = log.stdout = log.stderr = log.allToStderr = log.colorize = true;
  } else if (settings.log) {
    log = settings.log;
  }

  return new Promise<ExecResultType>(async (resolve, reject) => {
    if (log.exec) {
      logProcessExec(command, argv, {
        env: options?.env,
        envNames: log.envNames,
        pipe: pipe?.stream,
        toStderr: log.allToStderr,
      });
    }

    if (typeof options?.cwd === "string" && !(await checkDir(options.cwd)))
      throw new Error(
        `Current working directory does not exist: ${options.cwd}`
      );

    if (pipe?.stream instanceof ReadStream && "onReadProgress" in pipe) {
      const fileInfo = await stat(pipe.stream.path);
      const totalBytes = fileInfo.size;
      let currentBytes = 0;
      pipe.stream.on("data", (data) => {
        currentBytes += data.length;
        pipe.onReadProgress?.({
          totalBytes: totalBytes,
          currentBytes: currentBytes,
          progress: progressPercent(totalBytes, currentBytes),
        });
      });
    }
    const p = spawn(command, argv, options ?? {});

    await settings.onSpawn?.(p);

    let spawnError: Error;
    const spawnData: ExecResultType = {
      stdout: "",
      stderr: "",
      exitCode: 0,
    };

    let finishListeners = 1;
    if (pipe?.stream instanceof WriteStream) finishListeners++;
    if (settings.stdout?.parseLines) finishListeners++;

    let streamError: Error | undefined;

    const tryFinish = () => {
      if (!--finishListeners) finish();
    };

    const finish = () => {
      if (spawnData.exitCode) {
        let exitCodeError:
          | ((data: ExecResultType, error?: Error) => Error)
          | false
          | Error
          | undefined;
        if (settings.stderr?.toExitCode) {
          exitCodeError = new Error(
            `Exit code ${spawnData.exitCode}: ${spawnData.stderr
              .split(/\r?\n/g)
              .filter((v) => !!v.length)
              .join(" | ")}`
          );
        } else {
          exitCodeError = new Error(
            `Exit code: ${spawnData.exitCode} (${command} ${argv.join(" ")})`
          );
        }

        const exitCodeErrorResult = settings.onExitCodeError?.(
          spawnData,
          exitCodeError
        );

        if (exitCodeErrorResult instanceof Error) {
          return reject(exitCodeErrorResult);
        } else if (exitCodeErrorResult !== false) {
          return reject(exitCodeError);
        }
      }

      if (streamError) {
        reject(streamError);
      } else if (spawnError) {
        reject(spawnError);
      } else {
        resolve(spawnData);
      }
    };

    if (pipe) {
      pipe.stream.on("error", (error: Error) => {
        streamError = error;
        tryFinish();
      });
      if (pipe.stream instanceof WriteStream) {
        if (!p.stdout) throw new Error(`stdout is not defined`);
        if (!p.stderr) throw new Error(`stderr is not defined`);
        if ("onWriteProgress" in pipe && pipe.onWriteProgress) {
          let totalBytes = 0;
          p.stdout.on("data", (chunk: Buffer) => {
            totalBytes += chunk.length;
            pipe.onWriteProgress!({ totalBytes });
          });
          p.stderr.on("data", (chunk: Buffer) => {
            totalBytes += chunk.length;
            pipe.onWriteProgress!({ totalBytes });
          });
        }
        p.stdout.pipe(pipe.stream, { end: false });
        p.stderr.pipe(pipe.stream, { end: false });
        p.on("close", tryFinish);
      } else if (pipe.stream instanceof Readable) {
        if (!p.stdin) throw new Error(`stdin is not defined`);
        pipe.stream.pipe(p.stdin);
      }
    }

    if (log.stdout || settings.stdout) {
      if (!p.stdout) throw new Error(`stdout is not defined`);
      const parseLines = settings.stdout?.parseLines;
      const onData = (data: string | Buffer) => {
        if (log.stdout)
          logExecStdout({
            data: parseLines ? `${data}\n` : data.toString(),
            stderr: log.allToStderr,
            colorize: log.colorize,
          });
        if (settings.stdout?.save) spawnData.stdout += data.toString();
        if (settings.stdout?.onData) settings.stdout.onData(data.toString());
      };
      if (parseLines) {
        const rl = createInterface({
          input: p.stdout!,
        });
        rl.on("line", onData);
        rl.on("close", tryFinish);
      } else {
        p.stdout.on("data", onData);
      }
    }

    if (log.stderr || settings.stderr) {
      if (!p.stderr) throw new Error(`stderr is not defined`);
      p.stderr.on("data", (data: Buffer) => {
        if (log.stderr)
          logExecStdout({
            data: data.toString(),
            stderr: log.allToStderr,
            colorize: log.colorize,
          });
        if (settings.stderr?.save || settings.stderr?.toExitCode)
          spawnData.stderr += data.toString();
        if (settings.stderr?.onData) settings.stderr.onData(data.toString());
      });
    }

    p.on("error", (error) => (spawnError = error)).on("close", (exitCode) => {
      spawnData.exitCode = exitCode ?? 0;
      if (pipe?.stream instanceof WriteStream) pipe.stream.end();
      tryFinish();
    });
  });
}

type EventNameType =
  | "exit"
  | "SIGINT"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGTERM"
  | "uncaughtException";

const eventNames: EventNameType[] = [
  `exit`,
  `SIGINT`,
  `SIGUSR1`,
  `SIGUSR2`,
  `uncaughtException`,
  `SIGTERM`,
];

export function onExit(cb: (eventName: EventNameType, ...args: any[]) => void) {
  for (const eventName of eventNames) {
    process.on(eventName, (...args: any[]) => cb(eventName, ...args));
  }
}