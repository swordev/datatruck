import { renderProgressBar } from "./cli";
import { Timer, createTimer } from "./date";
import bytes from "bytes";
import { grey } from "chalk";
import { emitKeypressEvents } from "readline";

export type ProgressStats = {
  percent?: number;
  total?: number;
  current?: number;
  description?: string;
  payload?: string;
  format?: "amount" | "size";
};

export type Progress = {
  absolute?: ProgressStats;
  relative?: ProgressStats;
};

export class ProgressManager {
  protected timer = createTimer();
  protected interval: Timer | undefined = createTimer();
  protected keydownListener: ((data: Buffer) => void) | undefined;
  readonly tty: boolean;
  readonly enabled: boolean | "interval";
  constructor(
    readonly options: {
      verbose?: boolean;
      /**
       * @default true
       */
      tty?: boolean | "auto";
      enabled?: boolean | "auto" | "interval";
      interval?: number;
    },
  ) {
    this.tty =
      options.tty === "auto"
        ? options.verbose
          ? false
          : process.stdout.isTTY
        : !!options.tty;
    this.enabled =
      options.enabled === "auto"
        ? this.tty
          ? true
          : "interval"
        : !!options.enabled;
  }
  elapsed() {
    return this.timer.elapsed();
  }
  start() {
    this.timer.reset();
    emitKeypressEvents(process.stdin);
    process.stdin?.setRawMode?.(true);
    process.stdin?.resume();
    process.stdin?.setEncoding("utf8");
    process.stdin?.on(
      "keypress",
      (this.keydownListener = (inKey) => {
        const key = inKey.toString();
        if (key === "\u0003") {
          process.stdin.setRawMode?.(false);
          process.emit("SIGINT");
        } else if (/^(\r\n)|\r|\n$/.test(key)) {
          this.interval = undefined;
        }
      }),
    );
  }
  dispose() {
    this.timer.stop();
    if (this.keydownListener) {
      process.stdin?.off("keypress", this.keydownListener);
      this.keydownListener = undefined;
    }
  }
  update(progress: Progress, cb: (text: string) => void) {
    if (!this.enabled) return;
    if (this.enabled === "interval") {
      if (this.interval) {
        if (!this.interval.reset(this.options.interval ?? 5_000)) return;
      } else {
        this.interval = createTimer();
      }
    }
    cb(renderProgress(progress, this.tty).join("\n"));
  }
}

export function renderProgress(progress: Progress, bar?: boolean) {
  return [
    progress.absolute && renderProgressStats(progress.absolute, bar),
    progress.relative && renderProgressStats(progress.relative, bar),
  ].filter((v) => !!v) as any as string[];
}

export function renderProgressStats(
  stats: ProgressStats,
  progressBar?: boolean,
) {
  const text: string[] = [];
  if (typeof stats.percent === "number") {
    if (progressBar) text.push(renderProgressBar(stats.percent));
    text.push(`${stats.percent.toFixed(2).padStart(5, " ")}%`);
  }
  if (typeof stats.current === "number" || typeof stats.total === "number") {
    const format = (value: number) =>
      stats.format === "size" ? bytes(value) : value.toString();
    const pad = 8;
    let values: string[] = [];
    if (typeof stats.current === "number" && typeof stats.total === "number") {
      values = [
        format(stats.current).padStart(pad, " "),
        format(stats.total).padEnd(pad, " "),
      ];
    } else if (typeof stats.current === "number") {
      values = [format(stats.current).padStart(pad * 2 + 1)];
    } else if (typeof stats.total === "number") {
      values = ["?".padStart(pad, " "), format(stats.total).padEnd(pad, " ")];
    }
    if (values.length) text.push(values.join("/"));
  }
  if (stats.description && stats.payload) {
    text.push(`${stats.description}: ${stats.payload}`);
  } else if (stats.description) {
    text.push(stats.description);
  } else if (stats.payload) {
    text.push(stats.payload);
  }

  const sep = grey(`|`);
  return text.join(` ${sep} `);
}
