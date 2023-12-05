import { logExec } from "./cli";
import { existsDir } from "./fs";
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

export type ProcessEnv = {
  [name: string]: string | undefined;
};

export type ExecLogSettings = {
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
  log?: ExecLogSettings | boolean;
  onSpawn?: (p: ChildProcess) => void | undefined;
  stdout?: {
    save?: boolean;
    parseLines?: boolean | "skip-empty";
    onData?: (data: string) => void;
  };
  stderr?: {
    save?: boolean;
    parseLines?: boolean | "skip-empty";
    onData?: (data: string) => void;
    toExitCode?: boolean;
  };
  onExitCodeError?: (data: ExecResult, error: Error) => Error | false;
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

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type ParseStreamDataOptions<S extends boolean = boolean> = {
  save?: S;
  parseLines?: boolean;
  log?: LogProcessOptions | boolean;
  onData?: (data: string) => void;
};

export function parseStreamData<S extends boolean>(
  stream: Readable,
  options: ParseStreamDataOptions<S> = {},
): Promise<S extends true ? string : undefined> {
  const log = options.log === true ? {} : options.log;
  let result: string | undefined;

  if (options.save) result = "";

  return new Promise<any>((resolve, reject) => {
    const lines = options.parseLines;
    const onData = (data: Buffer | string) => {
      if (options.onData) options.onData(data.toString());
      if (log)
        logExecStdout({
          data: lines ? `${data}\n` : data.toString(),
          stderr: log.toStderr,
          colorize: log.colorize,
        });
      if (options?.save) result += data.toString();
    };
    if (lines) {
      const rl = createInterface({
        input: stream,
      });
      rl.on("line", onData).on("close", () => resolve(result));
    } else {
      stream
        .on("data", onData)
        .on("error", reject)
        .once("close", () => resolve(result));
    }
  });
}

type OnExitCode =
  | OnExitCodeValue
  | ((code: number) => OnExitCodeValue | void | undefined);
type OnExitCodeValue = Error | string | number | boolean;

export function waitForClose<O extends boolean, E extends boolean>(
  p: ChildProcess,
  options: {
    strict?: boolean;
    stdout?: O;
    stderr?: E;
    onExitCode?: OnExitCode;
  } = {},
): Promise<
  { exitCode: number } & (O extends true ? { stdout: string } : {}) &
    (E extends true ? { stderr: string } : {})
> {
  return new Promise<any>((resolve, reject) => {
    let result: any = {
      exitCode: 1,
    };
    if (options.stdout) {
      result.stdout = "";
      p.stdout!.on(
        "data",
        (data: Buffer) => (result.stdout += data.toString()),
      );
    }
    p.once("error", reject).once("close", (exitCode) => {
      if (exitCode) {
        let onExitCode = options.onExitCode ?? true;
        if (typeof onExitCode === "function") {
          onExitCode = onExitCode(exitCode!)!;
        }
        if (typeof onExitCode === "string") {
          reject(new Error(onExitCode));
        } else if (typeof onExitCode === "number") {
          reject(new Error(`Exit code: ${onExitCode}`));
        } else if (onExitCode instanceof Error) {
          reject(onExitCode);
        } else if (onExitCode === false) {
          resolve({ ...result, exitCode: exitCode! });
        } else {
          reject(new Error(`Exit code: ${exitCode}`));
        }
      } else {
        resolve({ ...result, exitCode: exitCode! });
      }
    });
  });
}

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

export type ProcessOptions<O1 extends boolean, O2 extends boolean> = {
  $stdout?: Omit<ParseStreamDataOptions<O1>, "log">;
  $stderr?: Omit<ParseStreamDataOptions<O2>, "log">;
  $onExitCode?: OnExitCode;
  $log?:
    | boolean
    | {
        exec?: boolean | LogProcessOptions;
        stdout?: boolean | LogProcessOptions;
        stderr?: boolean | LogProcessOptions;
      };
};

export function createProcess<O1 extends boolean, O2 extends boolean>(
  command: string,
  argv: (string | number)[] = [],
  options: SpawnOptions & ProcessOptions<O1, O2> = {},
): ChildProcessByStdio<Writable, Readable, Readable> &
  PromiseLike<
    { exitCode: number } & (O1 extends true ? { stdout: string } : {}) &
      (O2 extends true ? { stderr: string } : {})
  > {
  const $log =
    options.$log === true
      ? { exec: {}, stdout: {}, stderr: {} }
      : options.$log || {};
  if ($log.exec)
    logProcessExec(command, argv, $log.exec === true ? {} : $log.exec);

  if (typeof options.cwd === "string") {
    let isDir = false;
    try {
      isDir = statSync(options.cwd).isDirectory();
    } catch (error) {}
    if (!isDir)
      throw new Error(
        `Current working directory does not exist: ${options.cwd}`,
      );
  }

  const handler = spawn(
    command,
    argv.map((v) => (typeof v === "number" ? v.toString() : v)),
    options ?? {},
  );
  const { $stdout, $stderr, $onExitCode } = options;

  async function exec() {
    const [stdout, stderr, result] = await Promise.all([
      (!!$log.stdout || !!$stdout) &&
        parseStreamData(handler.stdout!, {
          log: $log.stdout,
          ...$stdout,
        }),
      (!!$log.stderr || !!$stderr) &&
        parseStreamData(handler.stderr!, {
          log: $log.stderr,
          ...$stderr,
        }),
      waitForClose(handler, {
        onExitCode: $onExitCode,
      }),
    ]);
    const endResult: {
      stdout?: string;
      stderr?: string;
      exitCode: number;
    } = {
      exitCode: result.exitCode,
    };
    if (typeof stdout === "string") endResult.stdout = stdout;
    if (typeof stderr === "string") endResult.stderr = stderr;
    return endResult as any;
  }
  const promise: Promise<any> = {
    [Symbol.toStringTag]: "process",
    then: function <TResult1 = any, TResult2 = never>(
      onfulfilled?:
        | ((value: any) => TResult1 | PromiseLike<TResult1>)
        | null
        | undefined,
      onrejected?:
        | ((reason: any) => TResult2 | PromiseLike<TResult2>)
        | null
        | undefined,
    ): Promise<TResult1 | TResult2> {
      return exec().then(onfulfilled, onrejected);
    },
    catch: function <TResult = never>(
      onrejected?:
        | ((reason: any) => TResult | PromiseLike<TResult>)
        | null
        | undefined,
    ): Promise<any> {
      return exec().catch(onrejected);
    },
    finally: function (
      onfinally?: (() => void) | null | undefined,
    ): Promise<any> {
      return exec().finally(onfinally);
    },
  };

  Object.assign(handler, promise);

  return handler as any;
}

export async function exec(
  command: string,
  argv: string[] = [],
  options: SpawnOptions | null = null,
  settings: ExecSettingsInterface = {},
) {
  const pipe = settings.pipe;
  let log: ExecLogSettings = {};
  if (settings.log === true) {
    log.exec = log.stdout = log.stderr = log.allToStderr = log.colorize = true;
  } else if (settings.log) {
    log = settings.log;
  }

  if (log.exec)
    logProcessExec(command, argv, {
      env: options?.env,
      envNames: log.envNames,
      pipe: pipe?.stream,
      toStderr: log.allToStderr,
    });

  if (typeof options?.cwd === "string" && !(await existsDir(options.cwd)))
    throw new Error(`Current working directory does not exist: ${options.cwd}`);

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
  settings.onSpawn?.(p);
  let spawnError: Error;
  const spawnData: ExecResult = {
    stdout: "",
    stderr: "",
    exitCode: 0,
  };

  let finishListeners = 1;
  if (pipe?.stream instanceof WriteStream) finishListeners++;
  if (settings.stdout?.parseLines) finishListeners++;
  if (settings.stderr?.parseLines) finishListeners++;

  let streamError: Error | undefined;

  return new Promise<ExecResult>((resolve, reject) => {
    const tryFinish = () => {
      if (!--finishListeners) finish();
    };
    const finish = () => {
      if (spawnData.exitCode) {
        let exitCodeError:
          | ((data: ExecResult, error?: Error) => Error)
          | false
          | Error
          | undefined;
        if (settings.stderr?.toExitCode) {
          exitCodeError = new Error(
            `Exit code ${spawnData.exitCode}: ${command} ${argv.join(
              " ",
            )} | ${spawnData.stderr
              .split(/\r?\n/g)
              .filter((v) => !!v.length)
              .join(" | ")}`,
          );
        } else {
          exitCodeError = new Error(
            `Exit code ${spawnData.exitCode}: ${command} ${argv.join(" ")}`,
          );
        }

        const exitCodeErrorResult = settings.onExitCodeError?.(
          spawnData,
          exitCodeError,
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

    const stdConfig = {
      stdout: { log: log.stdout, settings: settings.stdout },
      stderr: { log: log.stderr, settings: settings.stderr },
    };

    for (const inType in stdConfig) {
      const type = inType as "stdout" | "stderr";
      const enabled = log[type] || settings[type];
      if (!enabled) continue;
      if (!p[type]) throw new Error(`${type} is not defined`);
      const parseLines = settings[type]?.parseLines;
      const skipEmptyLines = parseLines === "skip-empty";
      const onData = (inData: string | Buffer) => {
        let data = inData.toString();
        if (parseLines) {
          if (skipEmptyLines && !data.trim().length) return;
          data = `${inData}\n`;
        }
        if (log[type])
          logExecStdout({
            data,
            stderr: log.allToStderr,
            colorize: log.colorize,
          });

        if (
          settings[type]?.save ||
          (type === "stderr" && settings[type]?.toExitCode)
        )
          spawnData[type] += data;

        if (settings[type]?.onData) settings[type]!.onData!(inData.toString());
      };
      if (parseLines) {
        const rl = createInterface({
          input: p[type]!,
        });
        rl.on("line", onData);
        rl.on("close", tryFinish);
      } else if (log[type] || settings[type]?.save || settings[type]?.onData) {
        p[type]!.on("data", onData);
      }
    }

    p.on("error", (error) => (spawnError = error)).on("close", (exitCode) => {
      spawnData.exitCode = exitCode ?? 0;
      if (pipe?.stream instanceof WriteStream) pipe.stream.end();
      tryFinish();
    });
  });
}
