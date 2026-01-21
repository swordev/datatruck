import {
  ensureFreeDiskSpace,
  fastFolderSizeAsync,
  fetchDiskStats,
} from "@datatruck/cli/utils/fs.js";
import { readFile } from "fs/promises";

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
