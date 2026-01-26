import { randomInt } from "crypto";

export function unstyle(str: string) {
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

const charset =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function randomString(length: number) {
  let string = "";
  for (let i = 0; i < length; i++) {
    const index = randomInt(0, charset.length);
    string += charset[index];
  }
  return string;
}
