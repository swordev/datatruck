export function unstyle(str: string) {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}
