import { logExec } from "./cli-util";
import { checkDir } from "./fs-util";
import { progressPercent } from "./math-util";
import chalk from "chalk";
import { SpawnOptions, spawn, ChildProcess } from "child_process";
import { ReadStream, WriteStream } from "fs";
import { stat } from "fs/promises";

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
  pipe?: {
    stream: WriteStream | ReadStream;
    onReadProgress?: (data: {
      totalBytes: number;
      currentBytes: number;
      progress: number;
    }) => void;
  };
  log?: ExecLogSettingsType | boolean;
  onSpawn?: (p: ChildProcess) => void;
  stdout?: { save?: boolean; onData?: (data: string) => void };
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
      const logEnv = log.envNames?.reduce((env, key) => {
        env[key] = options?.env?.[key] ?? "";
        return env;
      }, {} as NodeJS.ProcessEnv);
      logExec(
        command,
        pipe
          ? [
              ...argv,
              pipe.stream instanceof ReadStream ? "<" : ">",
              String(pipe.stream.path),
            ]
          : argv,
        logEnv,
        log.allToStderr
      );
    }

    if (typeof options?.cwd === "string" && !(await checkDir(options.cwd)))
      return reject(
        new Error(`Current working directory does not exist: ${options.cwd}`)
      );

    if (pipe?.onReadProgress && pipe.stream instanceof ReadStream) {
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
    const spawnData: ExecResultType = {
      stdout: "",
      stderr: "",
      exitCode: 0,
    };

    let finishListens = pipe ? 2 : 1;
    let streamError: Error | undefined;

    const tryFinish = () => {
      if (!--finishListens) finish();
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
        p.stdout.pipe(pipe.stream, { end: false });
        p.stderr.pipe(pipe.stream, { end: false });
        p.on("close", tryFinish);
      } else if (pipe.stream instanceof ReadStream) {
        if (!p.stdin) throw new Error(`stdin is not defined`);
        pipe.stream.pipe(p.stdin);
      }
    }

    if (log.stdout || settings.stdout) {
      if (!p.stdout) throw new Error(`stdout is not defined`);
      p.stdout.on("data", (data: Buffer) => {
        if (log.stdout)
          logExecStdout({
            data: data.toString(),
            stderr: log.allToStderr,
            colorize: log.colorize,
          });
        if (settings.stdout?.save) spawnData.stdout += data.toString();
        if (settings.stdout?.onData) settings.stdout.onData(data.toString());
      });
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
