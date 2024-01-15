import { logExec } from "./cli";
import { AppError } from "./error";
import { progressPercent } from "./math";
import { logStdout, logProcess } from "./process";
import { waitForClose } from "./stream";
import { ChildProcess, SpawnOptions, spawn } from "child_process";
import { ReadStream, createReadStream, createWriteStream, statSync } from "fs";
import { stat } from "fs/promises";
import { createInterface } from "readline";
import { Readable, Writable } from "stream";

export type AsyncProcessOptions = SpawnOptions & {
  $log?: AsyncProcessLog | boolean;
  $controller?: AbortController;
  $exitCode?: ExitCode;
};

type ExitCode =
  | ExitCodeValue
  | ((code: number) => ExitCodeValue | void | undefined);
type ExitCodeValue = Error | string | number | boolean;

function resolveLogOptions(
  log: AsyncProcessOptions["$log"],
): AsyncProcessLog | undefined {
  return log === true
    ? ({ exec: {}, stdout: {}, stderr: {} } as AsyncProcessLog)
    : log || undefined;
}

type AsyncProcessArgv = (string | number)[] | undefined;

function ensureDir(cwd: string) {
  if (typeof cwd === "string") {
    let isDir = false;
    try {
      isDir = statSync(cwd).isDirectory();
    } catch (error) {}
    if (!isDir)
      throw new AppError(`Current working directory does not exist: ${cwd}`);
  }
}

class StdIn {
  constructor(
    readonly process: AsyncProcess,
    readonly writable: Writable,
  ) {}
  async pipe(
    source: string | ReadStream,
    onProgress?: (data: {
      totalBytes: number;
      currentBytes: number;
      progress: number;
    }) => void,
  ) {
    if (this.process["log"]?.exec) {
      const path =
        source instanceof ReadStream
          ? "path" in source
            ? source.path
            : "&readableStream"
          : source;
      logExec(`[${this.process.child.pid || 0}] < ${path}`);
    }

    const stream =
      typeof source === "string" ? createReadStream(source) : source;
    const streamPath = stream.path.toString();

    if (onProgress) {
      const fileInfo = await stat(streamPath);
      const totalBytes = fileInfo.size;
      let currentBytes = 0;
      stream.on("data", (data) => {
        currentBytes += data.length;
        onProgress?.({
          totalBytes: totalBytes,
          currentBytes: currentBytes,
          progress: progressPercent(totalBytes, currentBytes),
        });
      });
    }

    stream.pipe(this.writable);

    await Promise.all([
      this.process.waitForClose(),
      waitForClose(stream),
      waitForClose(this.writable),
    ]);
  }
}

class Std {
  constructor(
    protected type: "stdout" | "stderr",
    readonly process: AsyncProcess,
    readonly readable: Readable,
  ) {}
  onData(cb: (chunk: Buffer) => void) {
    this.readable.on("data", cb);
  }
  async fetch() {
    let data = "";
    this.onData((chunk) => (data += chunk));
    await this.process.waitForClose();
    return data.trim();
  }
  async parseLines(cb: (line: string, total: number) => void) {
    let total = 0;
    const parser = createInterface({ input: this.readable });
    parser.on("line", (inLine) => {
      const line = inLine.toString().trim();
      if (line.length) cb(line, ++total);
    });
    await Promise.all([this.process.waitForClose(), waitForClose(parser)]);
    return total;
  }
  async pipe(
    out: string | NodeJS.WritableStream | StdIn,
    onProgress?: (data: { totalBytes: number }) => void,
  ) {
    if (this.process["log"]?.exec) {
      const path =
        out instanceof StdIn
          ? `${[out.process.child.pid || 0]}`
          : typeof out === "string"
            ? out
            : "path" in out
              ? out.path
              : "&writableStream";
      logExec(
        `[${this.process.child.pid || 0}] ${
          this.type === "stderr" ? 2 : ""
        }> ${path}`,
      );
    }

    if (onProgress) {
      let totalBytes = 0;
      this.readable.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        onProgress!({ totalBytes });
      });
    }

    const stream =
      out instanceof StdIn
        ? out.writable
        : typeof out === "string"
          ? createWriteStream(out)
          : out;

    this.readable.pipe(stream);

    await Promise.all([
      this.process.waitForClose().catch((error) => {
        if ("destroy" in stream) stream.destroy();
        return Promise.reject(error);
      }),
      waitForClose(stream),
      waitForClose(this.readable),
    ]);
  }
}

export type AsyncProcessLog = {
  colorize?: boolean;
  exec?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  allToStderr?: boolean;
  envNames?: string[];
};

export class AsyncProcess {
  readonly child: ChildProcess;
  readonly stdout: Std;
  readonly stderr: Std;
  readonly stdin: StdIn;
  protected log: AsyncProcessLog | undefined;
  protected controller: AbortController;
  private lastStdError: Buffer | undefined;
  constructor(
    protected command: string,
    protected argv: AsyncProcessArgv,
    protected options: AsyncProcessOptions = {},
  ) {
    const { $log, $controller, ...otherOptions } = options;

    this.log = resolveLogOptions($log);
    this.controller = $controller || new AbortController();

    if (this.log?.exec)
      logProcess(
        command,
        argv || [],
        this.log.exec === true ? {} : this.log.exec,
      );

    if (typeof options.cwd === "string") ensureDir(options.cwd);

    this.child = spawn(command, argv?.map(String) || [], otherOptions ?? {});
    if (this.log) this.installLog(this.log);
    this.installAbortController(this.controller);

    this.stdout = new Std("stdout", this, this.child.stdout!);
    this.stderr = new Std("stderr", this, this.child.stderr!);
    this.stdin = new StdIn(this, this.child.stdin!);
  }
  static async exec(
    command: string,
    argv: AsyncProcessArgv,
    options: AsyncProcessOptions = {},
  ) {
    const p = new AsyncProcess(command, argv, options);
    return await p.waitForClose();
  }

  static async stdout(
    command: string,
    argv: AsyncProcessArgv,
    options: AsyncProcessOptions = {},
  ) {
    const p = new AsyncProcess(command, argv, options);
    return await p.stdout.fetch();
  }
  private installLog(log: AsyncProcessLog) {
    if (log.stdout)
      this.child.stdout?.on("data", (chunk) =>
        logStdout({
          data: chunk.toString(),
          colorize: log.colorize,
          stderr: log.allToStderr,
        }),
      );
    if (log.stderr)
      this.child.stderr?.on("data", (chunk) =>
        logStdout({
          data: chunk.toString(),
          colorize: log.colorize,
          stderr: log.allToStderr,
        }),
      );
  }
  private installAbortController(controller: AbortController) {
    if (controller.signal.aborted) {
      this.child.kill();
    } else {
      controller.signal.addEventListener("abort", () => {
        this.child.kill();
      });
    }
  }
  private resolveExitCode(inExitCode: number | null): number | Error {
    let exitCode = inExitCode ?? 32;
    if (!exitCode) return exitCode;
    const lastStdError = this.lastStdError?.toString().trim().slice(0, 255);
    let result = this.options.$exitCode ?? true;
    let message = (
      inExitCode === null
        ? [`Process killed: ${this.command}`, lastStdError]
        : [`Process exit code: ${exitCode} (${this.command})`, lastStdError]
    )
      .filter((v) => typeof v === "string" && v.length)
      .join(" | ");
    if (typeof result === "function") result = result(exitCode!)!;
    if (typeof result === "string") {
      message = result;
    } else if (typeof result === "number") {
      exitCode = result;
    } else if (result instanceof Error) {
      return result;
    } else if (result === false) {
      return exitCode;
    }
    return new AppError(message, {
      cause: {
        command: this.command,
        argv: this.argv,
        exitCode,
        lastStdError,
      },
    });
  }
  async waitForClose() {
    if (!this.lastStdError) {
      this.lastStdError = Buffer.from([]);
      this.child.stderr?.on("data", (chunk) => {
        this.lastStdError = chunk;
      });
    }

    return new Promise<number>((resolve, reject) => {
      this.child.on("error", reject).on("close", (exitCode) => {
        const result = this.resolveExitCode(exitCode);
        typeof result === "number" ? resolve(result) : reject(result);
      });
    });
  }
}
