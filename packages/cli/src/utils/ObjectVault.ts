export type KeysType = (string | number)[];

export class ObjectVault<TObject> {
  protected counter: number = 0;
  protected readonly ids: Record<string, number> = {};
  protected readonly objects: Record<number, TObject> = {};

  static serializeKeys(keys: KeysType) {
    return JSON.stringify(keys);
  }

  get(id: number) {
    if (!(id in this.objects)) throw new Error(`Object not found: ${id}`);
    return this.objects[id];
  }

  getId(keys: KeysType) {
    const key = ObjectVault.serializeKeys(keys);
    const id = this.ids[key];
    if (!id) throw new Error(`Id not found: ${JSON.stringify(keys)}`);
    return id;
  }

  add(options: { keys: KeysType; handler: (id: number) => TObject }): TObject {
    const key = ObjectVault.serializeKeys(options.keys);
    const id = (this.ids[key] = ++this.counter);
    return (this.objects[id] = options.handler(id));
  }
}
