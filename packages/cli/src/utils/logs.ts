import { readdir, rm, stat } from "fs/promises";
import { platform } from "os";
import { join } from "path";

const maxAgeUnits = {
  minutes: () => 60 * 1000,
  hours: () => 60 * maxAgeUnits.minutes(),
  days: () => 24 * maxAgeUnits.hours(),
};

export type MaxAge = { days?: number; hours?: number; minutes?: number };

export function maxAgeToMS(input: MaxAge) {
  let ms = 0;
  for (const key in input) {
    const units = input[key as keyof MaxAge];
    if (units && units >= 0) {
      const factor = maxAgeUnits[key as keyof typeof maxAgeUnits]();
      ms += units * factor;
    }
  }
  return ms;
}

export const defaultsLogPath =
  platform() === "win32"
    ? join(
        process.env.APPDATA ?? `${process.env.HOMEDRIVE ?? "C:"}\\ProgramData`,
        "datatruck\\logs",
      )
    : "/var/logs/datatruck";

export async function removeOldLogs(path: string, inMaxAge: MaxAge) {
  const maxAge = maxAgeToMS(inMaxAge);
  const hasMaxAge = Object.values(inMaxAge).some((v) => typeof v === "number");
  if (!hasMaxAge) return [];
  const files = (await readdir(path)).filter((file) => file.endsWith(".log"));
  const now = Date.now();
  const paths: string[] = [];
  for (const file of files) {
    const filePath = join(path, file);
    const { mtimeMs } = await stat(join(path, file));
    const ms = now - mtimeMs;
    if (ms > maxAge) {
      await rm(filePath);
      paths.push(filePath);
    }
  }
  return paths;
}
