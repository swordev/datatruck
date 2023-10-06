import globalData from "../globalData";
import { tryRm } from "./fs";
import { randomUUID } from "crypto";
import { mkdir, rm } from "fs/promises";
import { join } from "path";

export function parentTmpDir() {
  return join(globalData.tempDir, "datatruck-temp");
}

export function sessionTmpDir() {
  return join(parentTmpDir(), process.pid.toString());
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
  for (const listener of listeners) listener.paths.push(path);
  return path;
}

type Listener = { paths: string[] };
const listeners = new Set<Listener>();

export async function mkTmpDir(...keys: [string, ...string[]]) {
  const path = tmpDir(...keys);
  await mkdir(path, { recursive: true });
  return path;
}

export class CleanupListener {
  readonly paths: string[] = [];
  stop() {
    listeners.delete(this);
  }
  async dispose() {
    this.stop();
    await rmTmpDir(this.paths);
  }
}

export class GargabeCollector {
  protected listeners: Set<CleanupListener> = new Set();
  get pending() {
    return this.listeners.size > 0;
  }
  async cleanup(cb?: () => any) {
    try {
      await cb?.();
    } finally {
      for (const listener of this.listeners) {
        this.listeners.delete(listener);
        await listener.dispose();
      }
    }
  }
  async cleanupOnFinish(cb: () => any) {
    const cleanup = new CleanupListener();
    try {
      await cb();
    } finally {
      cleanup.dispose();
    }
  }
  async cleanupIfFail(cb: () => any) {
    const cleanup = new CleanupListener();
    try {
      await cb();
    } catch (error) {
      await cleanup.dispose();
      throw error;
    }
    this.listeners.add(cleanup);
    return cleanup;
  }
}
