import {
  ensureFreeDiskSpace,
  fastFolderSizeAsync,
  fetchDiskStats,
} from "@datatruck/cli/utils/fs.js";
import { execSync } from "child_process";
import { mkdir, readFile, stat } from "fs/promises";
import { platform } from "os";
import { parse, resolve } from "path";

export async function parseJSONFile<T>(path: string): Promise<T> {
  const buffer = await readFile(path);
  return JSON.parse(buffer.toString());
}

export async function checkDiskSpace(options: {
  minFreeSpace?: string | undefined;
  minFreeSpacePath?: string | undefined;
  targetPath?: string | undefined;
  rutine: () => any;
}) {
  if (options.minFreeSpace) {
    const minFreeSpacePath = options.minFreeSpacePath ?? options.targetPath;
    if (minFreeSpacePath) {
      const diskStats = await fetchDiskStats(minFreeSpacePath);
      await ensureFreeDiskSpace(diskStats, options.minFreeSpace);
    }
  }

  if (!options.targetPath) {
    await options.rutine();
    return;
  }
  const prev = await fastFolderSizeAsync(options.targetPath);
  await options.rutine();
  const next = await fastFolderSizeAsync(options.targetPath);
  return {
    diff: next - prev,
    size: next,
  };
}

export async function getDiskName(inPath: string) {
  const path = resolve(inPath);
  if (platform() === "win32") {
    return parse(path).root[0];
  } else {
    return execSync(`df "${path}"`).toString().split("\n")[1].split(/\s+/)[0];
  }
}

export async function fetchMultipleDiskStats(paths: string[]) {
  for (const path of paths) {
    await mkdir(path, { recursive: true });
  }
  const devices: Record<string, string> = {};
  for (const inPath of paths) {
    const path = resolve(inPath);
    const info = await stat(path);
    if (!devices[info.dev]) devices[info.dev] = path;
  }

  const result: { name: string; free: number; total: number }[] = [];

  for (const dev in devices) {
    const path = devices[dev];
    const stats = await fetchDiskStats(path);
    result.push({
      name: await getDiskName(path),
      ...stats,
    });
  }
  return result;
}
