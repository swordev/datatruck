export function merge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Record<string, unknown>[]
) {
  const isObject = (o: unknown): o is Record<string, unknown> =>
    typeof o === "object" && o !== null;

  for (const source of sources)
    for (const key in source) {
      const a = source[key];
      const b = target[key];
      (target as any)[key] =
        isObject(b) && isObject(a) ? merge(b, a) : source[key];
    }

  return target;
}

export function push<T>(map: Record<string, T[]>, key: string, object: T) {
  if (!map[key]) map[key] = [];
  map[key].push(object);
}

export function getErrorProperties(error: Error) {
  const alt: Record<string, string> = {};

  for (const key of Object.getOwnPropertyNames(error)) {
    alt[key] = (error as any)[key];
  }

  return alt;
}

type GroupByKeyParamType<TItem> =
  | ((item: TItem) => string[] | string)
  | (keyof TItem)[]
  | keyof TItem;

export function groupBy<TItem>(
  items: TItem[],
  keyOrCb: GroupByKeyParamType<TItem>,
): Record<string, TItem[]>;
export function groupBy<TItem>(
  items: TItem[],
  keyOrCb: GroupByKeyParamType<TItem>,
  single: true,
): Record<string, TItem>;
export function groupBy<TItem>(
  items: TItem[],
  keyOrCb: GroupByKeyParamType<TItem>,
  single?: true,
) {
  const keyCb: (item: TItem) => string =
    typeof keyOrCb === "function"
      ? keyOrCb
      : Array.isArray(keyOrCb)
      ? (item) => keyOrCb.map((key) => item[key])
      : (item) => item[keyOrCb] as any;

  const stringify = (keys: string[] | string) =>
    typeof keys === "string"
      ? keys
      : keys.length == 1
      ? keys[0]
      : JSON.stringify(keys);

  if (single) {
    return items.reduce(
      (result, item) => {
        const resultKey = stringify(keyCb(item));
        result[resultKey] = item;
        return result;
      },
      {} as Record<string, TItem>,
    );
  } else {
    return items.reduce(
      (result, item) => {
        const resultKey = stringify(keyCb(item));
        if (!result[resultKey]) result[resultKey] = [];
        result[resultKey].push(item);
        return result;
      },
      {} as Record<string, TItem[]>,
    );
  }
}
