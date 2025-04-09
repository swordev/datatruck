import { formatBytes } from "./bytes";
import { renderProgressBar } from "./cli";
import { Timer, createTimer } from "./date";
import { triggerExitEvent } from "./exit";
import { grey } from "chalk";
import { emitKeypressEvents } from "readline";

export type BasicProgress = {
  percent: number;
  current: number;
  total: number;
};

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

export type ProgressTty = "auto" | boolean;
export type ProgressMode = "auto" | "interval" | `interval:${number}` | boolean;

export class ProgressManager {
  protected timer = createTimer();
  protected interval: Timer | undefined = createTimer();
  protected intervalMs: number;
  protected keydownListener: ((data: Buffer | undefined) => void) | undefined;
  protected pendingProgress: Progress | undefined;
  readonly tty: Exclude<ProgressTty, "auto">;
  readonly mode: Exclude<ProgressMode, "auto" | `interval:${number}`>;
  constructor(
    readonly options: {
      verbose?: boolean;
      /**
       * @default false
       */
      tty?: ProgressTty;
      /**
       * @default "interval"
       */
      mode?: ProgressMode;
    },
  ) {
    this.tty =
      options.tty === "auto"
        ? options.verbose
          ? false
          : process.stdout.isTTY
        : !!options.tty;

    const mode: Exclude<ProgressMode, "auto"> =
      options.mode === "auto"
        ? this.tty
          ? `interval:${300}`
          : "interval"
        : (options.mode ?? "interval");

    this.intervalMs = 1000;

    if (typeof mode === "string" && mode.startsWith("interval:")) {
      const [, ms] = mode.split(":");
      this.mode = "interval";
      if (/^\d+$/.test(ms)) this.intervalMs = Number(ms);
    } else {
      this.mode = mode as boolean | "interval";
    }
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
        const key = inKey?.toString() || "";
        if (key === "\u0003") {
          process.stdin.setRawMode?.(false);
          triggerExitEvent("SIGINT");
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
  create(
    input: ((text: string) => void) | { output: string },
    delay = 1_000,
  ): Disposable & { update: (progress: Progress) => void } {
    const update = (progress: Progress, force?: boolean) => {
      const text = this.renderProgress(progress, force);
      if (typeof text === "string") {
        if (typeof input === "function") {
          input(text);
        } else {
          input.output = text;
        }
      }
    };
    const updatePending = () => {
      const pendingProgress = this.pendingProgress;
      if (pendingProgress) {
        this.pendingProgress = undefined;
        update(pendingProgress, true);
      }
    };
    const interval = setInterval(updatePending, delay);
    return {
      update,
      [Symbol.dispose]: () => {
        clearInterval(interval);
        updatePending();
      },
    };
  }
  renderProgress(progress: Progress, force = false) {
    if (!this.mode) {
      return;
    } else if (this.mode === "interval") {
      if (this.interval) {
        if (!this.interval.reset(this.intervalMs) && !force) {
          this.pendingProgress = progress;
          return;
        }
      } else {
        this.interval = createTimer();
      }
    }
    this.pendingProgress = undefined;
    return renderProgress(progress, this.tty).join("\n");
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
      stats.format === "size" ? formatBytes(value) : value.toString();
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
