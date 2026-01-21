const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
const sizeRegex = new RegExp(
  `^(\\d+(?:\\.\\d+)?)\\s*(${units.join("|")})$`,
  "i",
);

export function formatBytes(inBytes: number, sign = false) {
  let u = 0;
  let n = Math.abs(inBytes);
  if (n < 0n) throw new Error(`Invalid bytes: ${n.toString()}`);
  while (n >= 1024n && ++u) n = n / 1024;
  const result = Number(n).toFixed(n < 10 && u > 0 ? 1 : 0) + units[u];
  return inBytes < 0 ? `-${result}` : `${sign ? "+" : ""}${result}`;
}

export function parseSize(size: string) {
  const matches = sizeRegex.exec(size);
  if (!matches) throw new Error(`Invalid size: ${size}`);
  const [, value, unit] = matches;
  const unitIndex = units.findIndex((v) => v === unit.toUpperCase());
  if (unitIndex === -1) throw new Error(`Unit not found: ${unit}`);
  let result = Number(value);
  for (let i = 0; i < unitIndex; ++i) result *= 1024;
  return result;
}
