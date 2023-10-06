import { renderProgressBar } from "./cli";
import bytes from "bytes";
import { grey } from "chalk";

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
  protected lastCall: number | undefined;
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
    /*process.stdin?.setRawMode(true);
    process.stdin?.on("data", (inKey) => {
      const key = inKey.toString();
      if (key === "\u0003") {
        process.exit(1);
      } else if (/^(\r\n)|\r|\n$/.test(key)) {
        this.lastCall = undefined;
      }
    });*/
  }
  protected checkInterval() {
    if (
      this.lastCall &&
      (performance.now() - this.lastCall || 0) <
        (this.options.interval ?? 5_000)
    )
      return false;
    this.lastCall = performance.now();
    return true;
  }
  update(progress: Progress, cb: (text: string) => void) {
    if (!this.enabled) return;
    if (this.enabled === "interval" && !this.checkInterval()) return;
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
    text.push(`${stats.percent.toFixed(2)}%`);
  }
  if (typeof stats.current === "number" || typeof stats.total === "number") {
    const format = (value: number) =>
      stats.format === "size" ? bytes(value) : value;
    if (typeof stats.current === "number" && typeof stats.total === "number") {
      text.push(`${format(stats.current)}/${format(stats.total)}`);
    } else if (typeof stats.current === "number") {
      text.push(`${format(stats.current)}`);
    } else if (typeof stats.total === "number") {
      text.push(`?/${format(stats.total)}`);
    }
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
