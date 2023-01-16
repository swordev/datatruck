export function makeTableSelector<T>(tableName: string) {
  const q = (value: unknown) => `\`${value}\``;
  const cb = (name?: keyof T) => `${q(tableName)}${name ? `.${q(name)}` : ""}`;
  cb.toString = cb;
  return cb;
}
