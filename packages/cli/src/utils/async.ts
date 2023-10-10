import { PromisePool } from "@supercharge/promise-pool";
import {
  Listr,
  ListrContext,
  ListrGetRendererClassFromValue,
  ListrLogger,
  ListrTask,
  PRESET_TIMER,
  PRESET_TIMESTAMP,
  ProcessOutput,
} from "listr2";

type ControllerItem = { stop?: () => void };
type ItemBuffer<T> = Map<T, ControllerItem>;

export class List3Logger<
  Levels extends string = string,
> extends ListrLogger<Levels> {
  constructor() {
    super({ processOutput: new ProcessOutput(process.stderr, process.stderr) });
  }
}

export class Listr3<Ctx = ListrContext> extends Listr<
  Ctx,
  "default",
  "simple"
> {
  protected beforeRun: ((list: this) => any) | undefined;
  protected afterRun: ((list: this) => any) | undefined;
  constructor(options: { ctx?: Ctx; tty?: () => boolean }) {
    super([], {
      ctx: options.ctx,
      renderer: "default",
      collectErrors: "minimal",
      fallbackRendererCondition: options.tty,
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
  }
  onBeforeRun(cb: (list: this) => any) {
    this.beforeRun = cb;
    return this;
  }
  onAfterRun(cb: (list: this) => any) {
    this.afterRun = cb;
    return this;
  }
  override add(
    tasks:
      | ListrTask<Ctx, ListrGetRendererClassFromValue<"default">>
      | ListrTask<Ctx, ListrGetRendererClassFromValue<"default">>[],
  ) {
    super.add(tasks);
    return this;
  }
  override async run(context?: Ctx): Promise<Ctx> {
    await this.beforeRun?.(this);
    try {
      return await super.run(context);
    } finally {
      await this.afterRun?.(this);
    }
  }
}

export async function runParallel<T>(options: {
  items: T[];
  concurrency: number;
  onChange: (data: {
    buffer: ItemBuffer<T>;
    processed: number;
    proccesing: number;
  }) => Promise<void> | void;
  onItem: (data: {
    item: T;
    index: number;
    controller: ControllerItem;
  }) => Promise<void> | void;
  onFinished?: () => Promise<void> | void;
}) {
  const buffer = new Map() as ItemBuffer<T>;
  let processed: number = 0;
  let error: Error | undefined;
  await PromisePool.for(options.items)
    .withConcurrency(options.concurrency)
    .process(async (item, index, pool) => {
      const controller = {};
      buffer.set(item, controller);
      try {
        await options.onChange({
          processed,
          proccesing: buffer.size,
          buffer,
        });
        await options.onItem({
          item,
          index,
          controller,
        });
      } catch (_error) {
        error = _error as Error;
        buffer.delete(item);
        pool.stop();
        for (const [, $controller] of buffer.entries())
          try {
            $controller.stop?.();
          } catch (_) {}
      } finally {
        buffer.delete(item);
        processed++;
        await options.onFinished?.();
        await options.onChange({
          processed,
          proccesing: buffer.size,
          buffer,
        });
      }
    });
  if (error) throw error;
}
