import { PromisePool } from "@supercharge/promise-pool";

type ItemBuffer<T> = Map<T, AbortController>;

export async function runParallel<T>(options: {
  items: T[];
  concurrency: number;
  onChange?: (data: {
    buffer: ItemBuffer<T>;
    processed: number;
    proccesing: number;
  }) => Promise<void> | void;
  onItem: (data: {
    item: T;
    index: number;
    controller: AbortController;
  }) => Promise<void> | void;
  onFinished?: () => Promise<void> | void;
}) {
  const buffer = new Map() as ItemBuffer<T>;
  let processed: number = 0;
  let error: Error | undefined;
  await PromisePool.for(options.items)
    .withConcurrency(options.concurrency)
    .process(async (item, index, pool) => {
      const controller = new AbortController();
      buffer.set(item, controller);
      try {
        await options.onChange?.({
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
            $controller.abort();
          } catch (_) {}
      } finally {
        buffer.delete(item);
        processed++;
        await options.onFinished?.();
        await options.onChange?.({
          processed,
          proccesing: buffer.size,
          buffer,
        });
      }
    });
  if (error) throw error;
}
