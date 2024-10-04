import globalData from "../globalData";
import { ensureFreeDiskSpace, mkdirIfNotExists } from "./fs";
import { randomUUID } from "crypto";
import { mkdir, rm } from "fs/promises";
import { join } from "path";

(Symbol as any).dispose ??= Symbol("Symbol.dispose");
(Symbol as any).asyncDispose ??= Symbol("Symbol.asyncDispose");

export function parentTmpDir() {
  return join(globalData.tempDir, "datatruck-temp");
}

export function sessionTmpDir() {
  return join(parentTmpDir(), process.pid.toString());
}

export async function ensureFreeDiskTempSpace(size: number | string) {
  const path = sessionTmpDir();
  await mkdirIfNotExists(sessionTmpDir());
  await ensureFreeDiskSpace([path], size);
}

export function isTmpDir(path: string) {
  return path.startsWith(sessionTmpDir()) && path.includes("datatruck-temp");
}
export async function rmTmpDir(input: string | string[]) {
  if (typeof input === "string") {
    if (!isTmpDir(input)) throw new Error(`Path is not a temp dir: ${input}`);
    await rm(input, { recursive: true });
  } else {
    for (const path of input) await rmTmpDir(path);
  }
}

export function tmpDir(...keys: [string, ...string[]]) {
  const id = randomUUID().slice(0, 8);
  const path = join(
    sessionTmpDir(),
    [...keys, id].map(encodeURIComponent).join("-"),
  );
  if (collectors.size) {
    const lastListener = [...collectors.values()].at(collectors.size - 1);
    if (lastListener) lastListener.paths.add(path);
  }
  return path;
}

export const collectors = new Set<GargabeCollector>();

export async function mkTmpDir(...keys: [string, ...string[]]) {
  const path = tmpDir(...keys);
  await mkdir(path, { recursive: true });
  return path;
}

export async function useTempDir(
  ...keys: [string, ...string[]]
): Promise<AsyncDisposable & { path: string }> {
  const path = await mkTmpDir(...keys);
  return {
    path,
    async [Symbol.asyncDispose]() {
      try {
        await rmTmpDir(path);
      } catch (_) {}
    },
  };
}

export function useTempFile(path: string): AsyncDisposable & { path: string } {
  return {
    path,
    async [Symbol.asyncDispose]() {
      try {
        await rm(path, { recursive: true });
      } catch (_) {}
    },
  };
}

export class GargabeCollector {
  readonly paths: Set<string> = new Set();
  readonly children: Set<GargabeCollector> = new Set();
  constructor(protected verbose?: boolean) {
    collectors.add(this);
  }
  pending() {
    if (this.paths.size) return true;
    for (const child of this.children) if (child.pending()) return true;
    return false;
  }
  async cleanup() {
    for (const path of this.paths) {
      try {
        if (!this.verbose) await rmTmpDir(path);
        this.paths.delete(path);
      } catch (_) {}
    }
    for (const child of this.children) await child.cleanup();
  }
  async dispose() {
    await this.cleanup();
    collectors.delete(this);
  }
  async disposeIfFail<T>(cb: () => Promise<T>): Promise<T> {
    try {
      return await cb();
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }
  disposeOnFinish() {
    return {
      [Symbol.asyncDispose]: async () => {
        return this.dispose();
      },
    };
  }
  create() {
    const gc = new GargabeCollector(this.verbose);
    this.children.add(gc);
    return gc;
  }
}
