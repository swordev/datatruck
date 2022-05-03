export type EntityDecoratorDataType = {
  tableName: string;
};

export function EntityDecorator(data: EntityDecoratorDataType) {
  return function (constructor: Function) {
    EntityDecoratorHandler(constructor).set(data);
  };
}

export function EntityDecoratorHandler(
  constructor: Function & {
    __entity__?: EntityDecoratorDataType;
  }
) {
  return {
    get: () => constructor.__entity__ as EntityDecoratorDataType,
    set: (data: EntityDecoratorDataType) => (constructor.__entity__ = data),
  };
}

export default EntityDecorator;
