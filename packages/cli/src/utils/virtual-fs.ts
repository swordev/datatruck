import {
  DiskStats,
  ensureEmptyDir,
  existsDir,
  existsFile,
  fetchDiskStats,
  mkdirIfNotExists,
} from "./fs";
import { BasicProgress } from "./progress";
import {
  cp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
  stat,
} from "fs/promises";
import { join, resolve } from "path";

export function resolvePath(path: string) {
  const { pathname } = new URL(`file:///${path}`);
  return pathname;
}

export type FsOptions = {
  backend: string;
};

export abstract class AbstractFs {
  constructor(readonly options: FsOptions) {}
  resolvePath(path: string) {
    return resolve(join(this.options.backend ?? ".", resolvePath(path)));
  }

  abstract isLocal(): boolean;
  isRemote() {
    return !this.isLocal();
  }
  abstract existsDir(path: string): Promise<boolean>;
  abstract rename(source: string, target: string): Promise<void>;
  abstract mkdir(path: string): Promise<void>;
  abstract readFile(path: string): Promise<string>;
  abstract rmAll(path: string): Promise<void>;
  abstract readFileIfExists(path: string): Promise<string | undefined>;
  abstract readdir(path: string): Promise<string[]>;
  abstract ensureEmptyDir(path: string): Promise<void>;
  abstract writeFile(path: string, contents: string): Promise<void>;
  abstract upload(source: string, target: string): Promise<void>;
  abstract download(
    source: string,
    target: string,
    options?: {
      timeout?: number;
      onProgress?: (progress: BasicProgress) => void;
    },
  ): Promise<{ bytes: number }>;
  abstract fetchDiskStats(source: string): Promise<DiskStats>;
}

export class LocalFs extends AbstractFs {
  isLocal() {
    return true;
  }
  async existsDir(path: string) {
    return existsDir(this.resolvePath(path));
  }
  async rename(source: string, target: string) {
    await rename(this.resolvePath(source), this.resolvePath(target));
  }
  async mkdir(path: string) {
    await mkdirIfNotExists(this.resolvePath(path));
  }
  async ensureEmptyDir(path: string) {
    await ensureEmptyDir(this.resolvePath(path));
  }
  async readFile(path: string) {
    return (await readFile(this.resolvePath(path))).toString();
  }
  async readFileIfExists(inPath: string) {
    return (await existsFile(this.resolvePath(inPath)))
      ? await this.readFile(inPath)
      : undefined;
  }
  async readdir(path: string): Promise<string[]> {
    return await readdir(this.resolvePath(path));
  }
  async writeFile(path: string, contents: string) {
    await writeFile(this.resolvePath(path), contents);
  }
  async rmAll(path: string) {
    await rm(this.resolvePath(path), { recursive: true });
  }
  async fetchDiskStats(source: string) {
    return await fetchDiskStats(this.resolvePath(source));
  }
  async upload(source: string, target: string) {
    await cp(source, this.resolvePath(target));
  }
  async download(source: string, target: string) {
    const path = this.resolvePath(source);
    const { size: bytes } = await stat(path);
    await cp(path, target);
    return { bytes };
  }
}
