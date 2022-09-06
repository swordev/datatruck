import globalData from "../globalData";
import { rootPath } from "./path-util";
import { eachLimit } from "async";
import { randomBytes } from "crypto";
import fastFolderSize from "fast-folder-size";
import FastGlob from "fast-glob";
import { createReadStream, Dirent, Stats } from "fs";
import { createWriteStream, WriteStream } from "fs";
import {
  cp,
  readdir,
  readFile,
  stat,
  writeFile,
  mkdir,
  utimes,
  chmod,
  chown,
  opendir,
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

export async function applyPermissions(
  baseDir: string,
  permissionsPath: string
) {
  const singleReader = createInterface({
    input: createReadStream(permissionsPath),
  });

  for await (const line of singleReader) {
    const [rpath, rawUid, rawGui, rawMode] = line.split(":");
    const path = join(baseDir, rpath);
    if (!path.startsWith(baseDir)) {
      throw new Error(
        `Entry path is out of the base dir: (${path}, ${baseDir})`
      );
    }
    const uid = Number(rawUid);
    const guid = Number(rawGui);
    await chown(path, uid, guid);
    const mode = Number(rawMode);
    await chmod(path, mode);
  }
}

export function pathIterator(stream: AsyncIterable<string | Buffer>) {
  return stream as any as AsyncIterable<EntryObject>;
}

export function isLocalDir(path: string) {
  return /^[\/\.]|([A-Z]:)/i.test(path);
}

export async function isDirEmpty(path: string) {
  const files = await readDir(path);
  return !files.length;
}

export async function mkdirIfNotExists(path: string) {
  try {
    await mkdir(path, {
      recursive: true,
    });
  } catch (e) {}
  return path;
}

export async function ensureEmptyDir(path: string) {
  if (!(await isDirEmpty(path))) throw new Error(`Dir is not empty: ${path}`);
}

export async function existsDir(path: string) {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch (e) {
    return false;
  }
}

export async function writeJSONFile<T = any>(path: string, json: T) {
  await writeFile(path, JSON.stringify(json));
}

export async function readdirIfExists(path: string) {
  return await readDir(path, true);
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
  errorMessage = "Path not found"
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

export async function existsFile(path: string) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch (e) {
    return false;
  }
}

export function parentTmpDir() {
  return join(globalData.tempDir, "datatruck-temp");
}

export function sessionTmpDir() {
  return join(parentTmpDir(), process.pid.toString());
}

export function tmpDir(prefix: string, id?: string) {
  if (!id) id = randomBytes(8).toString("hex");
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
  positions: [number, number?]
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

export async function checkFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch (e) {
    return false;
  }
}

export async function checkDir(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch (e) {
    return false;
  }
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
  includeDir?: boolean
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
}) {
  const tempDir = await mkTmpDir("gitignore-list");
  const path = join(tempDir, `.gitignore`);
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

export async function waitForClose(stream: WriteStream) {
  return new Promise<WriteStream>(async (resolve, reject) => {
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
      async (entryPath) => await task(entryPath, input.sourcePath)
    );
  } else if (input.type === "stream") {
    await eachLimit(
      input.value as any as string[],
      options.concurrency ?? 1,
      async (entryPath) => await task(entryPath, input.basePath)
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
