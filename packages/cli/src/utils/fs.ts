import globalData from "../globalData";
import { progressPercent } from "./math";
import { rootPath } from "./path";
import { Progress } from "./progress";
import { eachLimit } from "async";
import { randomUUID } from "crypto";
import fastFolderSize from "fast-folder-size";
import FastGlob, { Entry, Options } from "fast-glob";
import { createReadStream, Dirent, ReadStream, Stats } from "fs";
import { createWriteStream, WriteStream } from "fs";
import {
  cp,
  readdir,
  readFile,
  stat,
  mkdir,
  utimes,
  chmod,
  chown,
  opendir,
  rm,
  writeFile,
} from "fs/promises";
import { release } from "os";
import { dirname, join, normalize, resolve } from "path";
import { isAbsolute } from "path";
import { createInterface, Interface } from "readline";
import { promisify } from "util";

export const isWSLSystem = release().includes("microsoft-standard-WSL");

export async function isEmptyDir(path: string) {
  const iterator = await opendir(path);
  let done = false;
  try {
    const next = await iterator[Symbol.asyncIterator]().next();
    done = !!next.done;
    return done;
  } finally {
    if (!done) {
      await iterator.close();
    }
  }
}

type EntryObject = {
  name: string;
  path: string;
  dirent: Dirent;
  stats: Stats;
};

function pathIterator(stream: AsyncIterable<string | Buffer>) {
  return stream as any as AsyncIterable<EntryObject>;
}

export function isLocalDir(path: string) {
  return /^[\/\.]|([A-Z]:)/i.test(path);
}

export async function mkdirIfNotExists(path: string) {
  await mkdir(path, {
    recursive: true,
  });
  return path;
}

export async function ensureEmptyDir(path: string) {
  if (!(await isEmptyDir(path))) throw new Error(`Dir is not empty: ${path}`);
}

export async function safeStat(path: string) {
  try {
    return await stat(path);
  } catch (e) {}
}

export async function existsDir(path: string) {
  return (await safeStat(path))?.isDirectory() ?? false;
}

export async function existsFile(path: string) {
  return (await safeStat(path))?.isFile() ?? false;
}

export async function writeJSONFile<T = any>(path: string, json: T) {
  await writeFile(path, JSON.stringify(json));
}

export const parseFileExtensions = ["json", "js", "ts", "yaml", "yml"];

export async function parseFile(path: string, jsKey?: string) {
  if (!isAbsolute(path)) path = join(process.cwd(), path);
  if (path.endsWith(".ts")) require("ts-node").register();
  if (path.endsWith(".yaml") || path.endsWith("yml")) {
    const contents = await readFile(path);
    return require("yaml").parse(contents.toString());
  } else if (path.endsWith(".json")) {
    return require(path);
  } else {
    const object = require(path);
    const value = jsKey ? object[jsKey] : object;
    return typeof value === "function" ? await value() : value;
  }
}

export function parsePackageFile() {
  return require(`${rootPath}/package.json`) as {
    name: string;
    version: string;
    description: string;
  };
}

export async function findFile(
  sourcePath: string,
  baseName: string,
  extensions: string[],
  errorMessage = "Path not found",
) {
  const info = await stat(sourcePath);
  let path: string | undefined;
  if (info.isDirectory()) {
    for (const ext of extensions) {
      const extPath = join(sourcePath, baseName) + "." + ext;
      if (await existsFile(extPath)) {
        path = extPath;
        break;
      }
    }
  } else {
    path = sourcePath;
  }
  if (typeof path !== "string") throw new Error(errorMessage);
  return path;
}

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
    await rm(input, {
      recursive: true,
    });
  } else {
    for (const path of input) await rmTmpDir(path);
  }
}

export function tmpDir(prefix: string, id?: string) {
  if (!id) id = randomUUID().slice(0, 8);
  return join(sessionTmpDir(), `${prefix}-${id}`);
}

export async function fastFolderSizeAsync(path: string) {
  return (await promisify(fastFolderSize)(path)) || 0;
}

export async function mkTmpDir(prefix: string, id?: string) {
  const path = tmpDir(prefix, id);
  await mkdir(path, { recursive: true });
  return path;
}

export async function readPartialFile(
  path: string,
  positions: [number, number?],
) {
  let result: string = "";

  const statResult = await stat(path);
  const size = statResult.size;
  let [start, end] = positions;

  if (start < 0) start = size + start;
  if (end && end < 0) end = size + end;

  if (typeof start === "number") start = Math.min(Math.max(start, 0), size);
  if (typeof end === "number") end = Math.min(Math.max(end, 0), size);

  return new Promise<string>((resolve, reject) => {
    const reader = createReadStream(path, {
      start: start,
      end: end,
    });
    reader
      .on("error", reject)
      .on("data", (chunk: Buffer) => {
        result += chunk.toString();
      })
      .on("close", () => resolve(result));
  });
}

export async function readDir(path: string, optional?: boolean) {
  try {
    return await readdir(path);
  } catch (anyError) {
    const nodeError = anyError as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      if (optional) return [];
      const error: NodeJS.ErrnoException = new Error(nodeError.message);
      error.code = nodeError.code;
      error.errno = nodeError.errno;
      error.path = nodeError.path;
      throw error;
    }
    throw anyError;
  }
}

export async function forEachFile(
  dirPath: string,
  cb: (path: string, dir: boolean) => void,
  includeDir?: boolean,
) {
  const files = await readDir(dirPath);
  for (const file of files) {
    const filePath = join(dirPath, file);
    if ((await stat(filePath)).isDirectory()) {
      if (includeDir) cb(filePath, true);
      await forEachFile(filePath, cb, includeDir);
    } else {
      cb(filePath, false);
    }
  }
}

/**
 * @experimental
 */

export function fastglobToGitIgnore(patterns: string[], baseDir: string) {
  // https://github.com/mrmlnc/fast-glob#readme
  // https://git-scm.com/docs/gitignore
  return patterns.map((p) => `${baseDir}/${p}`);
}

export async function writeGitIgnoreList(options: {
  paths: NodeJS.ReadableStream | string[];
  outDir: string;
}) {
  const { outDir } = options;
  const path = join(outDir, `.gitignore`);
  const stream = createWriteStream(path);
  const dirs = new Set();
  stream.write("*\n");
  for await (const value of options.paths) {
    const dir = dirname(value.toString());
    if (dir !== ".") {
      let parentPath: string | undefined;
      for (const value of dir.split("/")) {
        if (!parentPath) {
          parentPath = `!${value}`;
        } else {
          parentPath += `/${value}`;
        }
        if (!dirs.has(parentPath)) {
          stream.write(`${parentPath}\n`);
          stream.write(`${parentPath.slice(1)}/*\n`);
          dirs.add(parentPath);
        }
      }
    }
    stream.write(`!${value}\n`);
  }

  await new Promise((resolve, reject) => {
    stream.close();
    stream.on("close", resolve);
    stream.on("error", reject);
  });

  return path;
}

export async function waitForClose(stream: WriteStream | ReadStream) {
  return new Promise<void>(async (resolve, reject) => {
    stream.on("close", resolve);
    stream.on("error", reject);
    return stream;
  });
}

export async function copyFileWithStreams(source: string, target: string) {
  const r = createReadStream(source);
  const w = createWriteStream(target);
  try {
    return await new Promise((resolve, reject) => {
      r.on("error", reject);
      w.on("error", reject);
      w.on("finish", resolve);
      r.pipe(w);
    });
  } catch (error) {
    r.destroy();
    w.end();
    throw error;
  }
}

export async function updateFileStats(path: string, fileInfo: Stats) {
  await utimes(path, fileInfo.atime, fileInfo.mtime);
  await chmod(path, fileInfo.mode);
  await chown(path, fileInfo.uid, fileInfo.gid);
}

export function isNotFoundError(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function cpy(options: {
  input:
    | {
        type: "glob";
        sourcePath: string;
        include?: string[];
        exclude?: string[];
      }
    | {
        type: "stream";
        basePath: string;
        value: Interface;
      }
    | {
        type: "pathList";
        path: string;
        basePath: string;
      };
  targetPath: string;
  /**
   * @default 1
   */
  concurrency?: number;
  skipNotFoundError?: boolean;
  onProgress?: (data: {
    current: number;
    path?: string;
    type?: "start" | "end";
  }) => Promise<boolean | void>;
  onPath?: (data: {
    isDir: boolean;
    entryPath: string;
    entrySourcePath: string;
    entryTargetPath: string;
    stats: { paths: number; files: number; dirs: number };
  }) => Promise<boolean | void>;
}) {
  const stats = { paths: 0, files: 0, dirs: 0 };
  const dirs = new Set<string>();

  const makeRecursiveDir = async (path: string) => {
    if (!dirs.has(path)) {
      stats.paths++;
      stats.dirs++;
      await mkdir(path, {
        recursive: true,
      });
      dirs.add(path);
    }
  };

  const task = async (rawEntryPath: string, basePath: string) => {
    [rawEntryPath] = rawEntryPath.split(":");
    const isDir = rawEntryPath.endsWith("/");
    const entryPath = normalize(rawEntryPath);
    const entrySourcePath = resolve(join(basePath, rawEntryPath));
    const entryTargetPath = resolve(join(options.targetPath, rawEntryPath));
    const onPathResult = await options?.onPath?.({
      isDir,
      entryPath,
      entrySourcePath,
      entryTargetPath,
      stats,
    });
    if (onPathResult === false) {
      return;
    } else if (isDir) {
      await makeRecursiveDir(entryTargetPath);
    } else {
      const dir = dirname(entryTargetPath);
      await makeRecursiveDir(dir);

      await options.onProgress?.({
        current: stats.files,
        path: entryPath,
      });

      stats.files++;

      // https://github.com/nodejs/node/issues/44261
      if (isWSLSystem) {
        let fileInfo!: Stats | undefined;
        try {
          fileInfo = await stat(entrySourcePath);
        } catch (error) {
          const skipError = options.skipNotFoundError && isNotFoundError(error);
          if (!skipError) throw error;
        }
        if (fileInfo) {
          const isWritable = (fileInfo.mode & 0o200) === 0o200;
          if (!isWritable) {
            await copyFileWithStreams(entrySourcePath, entryTargetPath);
            await updateFileStats(entryTargetPath, fileInfo);
            return;
          }
        }
      }

      try {
        await cp(entrySourcePath, entryTargetPath, {
          preserveTimestamps: true,
        });
      } catch (error) {
        const skipError = options.skipNotFoundError && isNotFoundError(error);
        if (!skipError) throw error;
      }
    }
  };

  const { input } = options;

  if (input.type === "glob") {
    const stream = await FastGlob(input.include || ["**"], {
      cwd: input.sourcePath,
      ignore: input.exclude,
      dot: true,
      onlyFiles: false,
      markDirectories: true,
    });
    await eachLimit(
      stream,
      options.concurrency ?? 1,
      async (entryPath) => await task(entryPath, input.sourcePath),
    );
  } else if (input.type === "stream") {
    await eachLimit(
      input.value as any as string[],
      options.concurrency ?? 1,
      async (entryPath) => await task(entryPath, input.basePath),
    );
  } else if (input.type === "pathList") {
    const stream = createInterface({
      input: createReadStream(input.path),
    });
    await cpy({
      ...options,
      input: {
        type: "stream",
        value: stream,
        basePath: input.basePath,
      },
    });
  }

  await options.onProgress?.({
    current: stats.files,
    type: "end",
  });

  return stats;
}

export async function createFileScanner(options: {
  glob: Options & {
    include: string[];
  };
  onProgress: (data: Progress) => Promise<void>;
}) {
  const object = {
    disposed: false,
    total: 0,
    current: 0,
    progress: async (description: string, path?: string) => {
      if (object.disposed) return;
      if (path) object.current++;
      await options.onProgress({
        relative: {
          description,
          payload: path,
        },
        absolute: {
          total: object.total,
          current: object.current,
          percent: progressPercent(object.total, object.current),
        },
      });
    },
    end: async () => {
      if (!object.disposed) await object.progress("Finished");
      object.disposed = true;
    },
    start: async (cb?: (entry: Required<Entry>) => any) => {
      let lastTime = performance.now();
      await object.progress("Scanning files");
      for await (const entry of pathIterator(stream)) {
        if (cb) {
          if (await cb(entry)) object.total++;
        } else {
          object.total++;
        }
        if (lastTime - performance.now() > 500)
          await object.progress("Scanning files");
      }
      await object.progress("Scanned files");
    },
  };

  const stream = FastGlob.stream(options.glob.include, {
    dot: true,
    markDirectories: true,
    stats: true,
    ...options.glob,
  });

  return object;
}

type StreamItem = {
  key: string;
  stream: WriteStream;
  finished: boolean;
  error?: Error;
  written?: boolean;
};

export function createWriteStreamPool(options: {
  path: string;
  onStreamPath?: (key: string) => string;
}) {
  const pool: Record<string, StreamItem> = {};
  const create = (key: string) => {
    const item: StreamItem = {
      key,
      stream: createWriteStream(
        join(
          options.path,
          options.onStreamPath ? options.onStreamPath(key) : key,
        ),
      ),
      finished: false,
    };
    item.stream
      .once("error", (error) => {
        item.finished = true;
        item.error = error;
      })
      .once("close", () => (item.finished = true));

    return (pool[item.key] = item);
  };
  return {
    pool,
    path(key: string | number) {
      const item = pool[key];
      if (!item) return;
      if (typeof item.stream.path !== "string")
        throw new Error(`Stream path is not defined: ${key}`);
      return item.stream.path;
    },
    writeLine(key: string | number, v: string) {
      const item = pool[key] || create(key.toString());
      if (item.finished) {
        return false;
      } else if (item.written) {
        return item.stream.write(`\n${v}`);
      } else {
        item.written = true;
        return item.stream.write(`${v}`);
      }
    },
    async end() {
      const items = Object.values(pool);
      for (const item of items) if (!item.finished) item.stream.end();
      const itemWithErrors = items.filter((v) => v.error);
      if (itemWithErrors.length) {
        const keys = itemWithErrors.map((item) => item.key);
        throw new AggregateError(
          itemWithErrors.map((item) => item.error!),
          `Streams faileds: ${keys.join(", ")}`,
        );
      }
      await Promise.all(
        items
          .filter((item) => !item.finished)
          .map((item) => waitForClose(item.stream)),
      );
    },
  };
}

export function countFileLines(path: string) {
  let lines = 0;
  const rl = createInterface({
    input: createReadStream(path),
  });
  return new Promise<number>((resolve, reject) => {
    rl.on("line", (line) => {
      if (!line.length) lines++;
    });
    rl.on("close", () => resolve(lines));
    rl.on("error", reject);
  });
}
