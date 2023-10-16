import { Timer, createTimer } from "./date";
import { ProgressManager } from "./progress";
import { Streams, createStreams } from "./stream";
import {
  Listr,
  ListrGetRendererClassFromValue,
  ListrLogger,
  ListrTask,
  PRESET_TIMER,
  PRESET_TIMESTAMP,
  ProcessOutput,
  ListrTaskWrapper,
} from "listr2";

export class List3Logger<
  Levels extends string = string,
> extends ListrLogger<Levels> {
  constructor(
    options: {
      streams?: Partial<Streams>;
    } = {},
  ) {
    const streams = createStreams(options.streams);
    super({
      processOutput: new ProcessOutput(
        streams.stdout as any,
        streams.stderr as any,
      ),
    });
  }
}

export type Listr3Context = Record<string, Record<string, any>>;

type KeyIndex = number | string | (string | number)[];

type Listr3Task<T extends Listr3Context, K extends keyof T> = {
  key: K;
  keyIndex?: KeyIndex;
  data: T[K];
  title:
    | string
    | {
        initial: string;
        started?: string;
        failed?: string;
        completed?: string;
      };
  runWrapper?: (cb: () => any) => any;
  run: (
    task: ListrTaskWrapper<any, any, any>,
    data: T[K],
  ) =>
    | Promise<void | ListrTask[] | Listr | undefined>
    | void
    | undefined
    | ListrTask[]
    | Listr;
  exitOnError?: boolean;
  enabled?: boolean;
  skip?: boolean;
};

type List3TaskResultObject<K, D extends Record<string, any>> = {
  key: K;
  keyIndex?: string;
  data: D;
  elapsed: number;
  error?: Error;
};
type SummaryResult = List3TaskResultObject<"summary", { errors: number }>;

export type Listr3TaskResult<T extends Listr3Context> = {
  [K in keyof T]: List3TaskResultObject<K, T[K]>;
}[keyof T];

export type Listr3TaskResultEnd<T extends Listr3Context> =
  | Listr3TaskResult<T>
  | SummaryResult;

export class Listr3<T extends Listr3Context> extends Listr<
  void,
  "default",
  "simple"
> {
  readonly resultMap: Record<string, Listr3TaskResult<T>> = {};
  readonly resultList: Listr3TaskResult<T>[] = [];
  protected execTimer: Timer;
  constructor(
    readonly $options: {
      streams?: Streams;
      progressManager?: ProgressManager;
    },
  ) {
    super([], {
      renderer: "default",
      collectErrors: "minimal",
      ...($options.progressManager && {
        fallbackRendererCondition: () => !$options.progressManager!.tty,
      }),
      fallbackRenderer: "simple",
      fallbackRendererOptions: {
        logger: new List3Logger(),
        timestamp: PRESET_TIMESTAMP,
        timer: PRESET_TIMER,
      },
      rendererOptions: {
        logger: new List3Logger(),
        collapseSubtasks: false,
        collapseErrors: false,
        timer: PRESET_TIMER,
      },
    });
    this.execTimer = createTimer();
  }
  private serializeKeyIndex(keyIndex?: KeyIndex): string[] {
    return keyIndex
      ? Array.isArray(keyIndex)
        ? keyIndex.map((k) => k.toString())
        : [keyIndex.toString()]
      : [];
  }
  private createResultIndex(key: keyof T, keyIndex?: KeyIndex): string {
    return [key, ...this.serializeKeyIndex(keyIndex)].join(".");
  }
  result(key: keyof T, keyIndex?: KeyIndex): Listr3TaskResult<T> {
    const index = this.createResultIndex(key, keyIndex);
    const result = this.resultMap[index];
    if (!result) throw new Error(`Task result not found: ${index}`);
    return result;
  }
  $task<K extends keyof T>(item: Listr3Task<T, K>): ListrTask {
    const index = this.createResultIndex(item.key, item.keyIndex);
    if (this.resultMap[index])
      throw new Error(`Duplicated task index: ${index}`);
    this.resultMap[index] = {
      key: item.key,
      keyIndex: item.keyIndex
        ? this.serializeKeyIndex(item.keyIndex).join(".")
        : undefined,
      elapsed: 0,
      error: undefined,
      data: item.data,
    };
    this.resultList.push(this.resultMap[index]);
    const title =
      typeof item.title === "string" ? { initial: item.title } : item.title;
    return {
      title: title.initial,
      exitOnError: item.exitOnError,
      enabled: item.enabled,
      skip: item.skip,
      task: async (_, task) => {
        const result = this.result(item.key, item.keyIndex);
        if (title.started) task.title = title.started;
        const timer = createTimer();
        if (title)
          try {
            const runResult = item.runWrapper
              ? await item.runWrapper(
                  async () => await item.run(task, result.data as any),
                )
              : await item.run(task, result.data as any);
            if (title.completed) task.title = title.completed;
            return Array.isArray(runResult)
              ? task.newListr(runResult)
              : runResult;
          } catch (error) {
            result.error = error as Error;
            if (title.failed) task.title = title.failed;
            throw error;
          } finally {
            result.elapsed = timer.elapsed();
          }
      },
    };
  }
  $tasks<K extends keyof T>(
    ...items: (Listr3Task<T, K> | ListrTask | false)[]
  ): ListrTask[] {
    return items
      .map((item) => (item ? ("key" in item ? this.$task(item) : item) : null))
      .filter(Boolean) as ListrTask[];
  }
  override add(
    tasks:
      | ListrTask<void, ListrGetRendererClassFromValue<"default">>
      | ListrTask<void, ListrGetRendererClassFromValue<"default">>[],
  ) {
    super.add(tasks);
    return this;
  }
  getSummaryResult(): SummaryResult {
    return {
      key: "summary",
      elapsed: this.execTimer.elapsed(),
      data: {
        errors: this.resultList.filter((i) => i.error).length,
      },
    };
  }
  getResult() {
    return [...this.resultList, this.getSummaryResult()];
  }
  async exec(): Promise<(Listr3TaskResult<T> | SummaryResult)[]> {
    try {
      this.$options.progressManager?.start();
      this.execTimer.reset();
      await super.run();
      return this.getResult();
    } catch (error) {
      throw error;
    } finally {
      this.$options.progressManager?.dispose();
    }
  }
}