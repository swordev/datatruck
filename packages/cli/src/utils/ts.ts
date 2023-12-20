export type DeepReadonly<T> = T extends (infer R)[]
  ? DeepReadonlyArray<R>
  : T extends Function
    ? T
    : T extends object
      ? DeepReadonlyObject<T>
      : T;

export interface DeepReadonlyArray<T> extends ReadonlyArray<DeepReadonly<T>> {}

export type DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export type If<TResolved, T1, T2 = string> = TResolved extends true ? T1 : T2;
export type IfRequireKeys<TResolved, T1> = TResolved extends true
  ? RequiredKeys<T1>
  : T1;

export type Unwrap<T> = T extends Promise<infer U>
  ? U
  : T extends (...args: any) => Promise<infer U>
    ? U
    : T extends (...args: any) => infer U
      ? U
      : T;

export type RequiredKeys<T> = {
  [K in keyof Required<T>]: T[K];
};

export type SimilarObject<T1> = { [K in keyof T1]: unknown };

export {};
