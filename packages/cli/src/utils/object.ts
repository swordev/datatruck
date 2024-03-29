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

export function omitProp<T extends Record<string, any>, N extends keyof T>(
  object: T,
  name: N,
): Omit<T, N> {
  const result = { ...object };
  delete result[name];
  return result;
}

export function pickProps<
  T extends Record<string, any>,
  I extends { [K in keyof T]?: boolean },
>(
  object: T,
  input: I,
): {
  [K in keyof T as K extends keyof I
    ? [I[K]] extends [true]
      ? K
      : never
    : never]: T[K];
} {
  const result = {} as Record<string, any>;
  for (const name in input) {
    if (input[name]) result[name] = object[name];
  }
  return result as any;
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

export class StrictMap<K, V> {
  constructor(readonly serializeKey: (params: K) => string) {}
  readonly map: Map<string, V | undefined> = new Map();
  has(key: K): boolean {
    return this.map.has(this.serializeKey(key));
  }
  get(key: K): NonNullable<V> {
    const stringKey = this.serializeKey(key);
    const value = this.map.get(stringKey);
    if (!value) throw new Error(`Map key does not exist: ${stringKey}`);
    return value;
  }
  set(key: K, value: V): void {
    const stringKey = this.serializeKey(key);
    if (this.map.has(stringKey))
      throw new Error(`Map key already exists: ${stringKey}`);
    this.map.set(stringKey, value);
  }
  withKey(key: K) {
    return {
      has: () => this.has(key),
      get: () => this.get(key),
      set: (value: V) => this.set(key, value),
    };
  }
}
