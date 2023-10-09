import { PromisePool } from "@supercharge/promise-pool";
import {
  Listr,
  ListrContext,
  ListrPrimaryRendererValue,
  ListrRendererValue,
  ListrSecondaryRendererValue,
} from "listr2";

type ControllerItem = { stop?: () => void };
type ItemBuffer<T> = Map<T, ControllerItem>;

export class Listr3<
  Ctx = ListrContext,
  Renderer extends ListrRendererValue = ListrPrimaryRendererValue,
  FallbackRenderer extends ListrRendererValue = ListrSecondaryRendererValue,
> extends Listr<Ctx, Renderer, FallbackRenderer> {
  protected beforeRun: (() => any) | undefined;
  protected afterRun: (() => any) | undefined;
  onBeforeRun(cb: () => any) {
    this.beforeRun = cb;
    return this;
  }
  onAfterRun(cb: () => any) {
    this.afterRun = cb;
    return this;
  }
  override async run(context?: Ctx): Promise<Ctx> {
    await this.beforeRun?.();
    try {
      return await super.run(context);
    } finally {
      await this.afterRun?.();
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
