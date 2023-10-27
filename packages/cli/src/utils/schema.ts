import { omitProp } from "./object";
import { JSONSchema7 } from "json-schema";

export function omitPropertySchema<
  T extends { properties: Record<string, any> },
  N extends keyof T["properties"],
>(
  object: T,
  name: N,
): Omit<T, "properties"> & { properties: Omit<T["properties"], N> } {
  return {
    ...object,
    properties: omitProp(object.properties, name as any),
  };
}

type IfSchema<
  KType extends string,
  KValue extends string,
  T extends string,
  V extends JSONSchema7,
> = {
  if: {
    type: "object";
    properties: {
      [k in KType]: { const: T };
    };
  };
  then: {
    type: "object";
    properties: {
      [k in KValue]: V;
    };
  };
  else: false;
};

export function createCaseSchema<
  KType extends string,
  KValue extends string,
  V extends { [K in KType]: JSONSchema7 },
>(
  keys: { type: KType; value: KValue },
  value: V,
): IfSchema<KType, KValue, string, JSONSchema7>[] {
  return Object.entries(value).reduce(
    (schemas, [type, value]) => {
      schemas.push(createIfSchema(keys, type, value as JSONSchema7));
      return schemas;
    },
    [] as IfSchema<KType, KValue, string, JSONSchema7>[],
  );
}

export function createIfSchema<
  KType extends string,
  KValue extends string,
  T extends string,
  V extends JSONSchema7,
>(
  keys: { type: KType; value: KValue },
  type: T,
  value: V,
): IfSchema<KType, KValue, T, V> {
  return {
    if: {
      type: "object",
      properties: {
        [keys.type]: { const: type },
      } as any,
    },
    then: {
      type: "object",
      properties: {
        [keys.value]: value,
      } as any,
    },
    else: false,
  };
}
