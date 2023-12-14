export function createWatcher<T = string>(options: {
  onRead: () => Promise<T>;
  onCheck?: (prev: T | undefined, current: T | undefined) => boolean;
  onChange?: (data: T | undefined) => void;
  onError?: (error: Error) => void;
  interval?: number;
}) {
  let prev: T | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const onCheck = options.onCheck || ((prev, current) => prev === current);
  const rutine = async (initial = false) => {
    try {
      let current: any = await options.onRead();
      if (!onCheck(prev, current)) {
        prev = current;
        if (!initial) options.onChange?.(current);
      }
    } catch (error) {
      options.onError?.(error as Error);
    }
  };

  return {
    start: () => {
      clearInterval(interval);
      rutine(true).finally(() => {
        interval = setInterval(rutine, options.interval ?? 5_000);
      });
    },
    stop: () => {
      clearInterval(interval);
      interval = undefined;
    },
  };
}
