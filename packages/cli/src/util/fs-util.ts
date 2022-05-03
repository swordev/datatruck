import { randomBytes } from "crypto";
import { createReadStream } from "fs";
import { createWriteStream, WriteStream } from "fs";
import { mkdir } from "fs-extra";
import { readdir, readFile, stat, writeFile } from "fs/promises";
import { isMatch } from "micromatch";
import { tmpdir } from "os";
import { join } from "path";
import { isAbsolute } from "path";

export function isLocalDir(path: string) {
  return /^[\/\.]|([A-Z]:)/i.test(path);
}

export async function isDirEmpty(path: string) {
  const files = await readdir(path);
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
  if (!(await existsDir(path))) return [];
  return await readdir(path);
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
  return require(`${__dirname}/../../package.json`) as {
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
  const tmpDir = tmpdir();
  return join(tmpDir, "datatruck");
}

export function sessionTmpDir() {
  return join(parentTmpDir(), process.pid.toString());
}

export function tmpDir(prefix: string, id?: string) {
  if (!id) id = randomBytes(8).toString("hex");
  return join(sessionTmpDir(), `${prefix}-${id}`);
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

export async function forEachFile(
  dirPath: string,
  cb: (path: string, dir: boolean) => void,
  includeDir?: boolean
) {
  const files = await readdir(dirPath);
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

export async function writePathLists(options: {
  paths: NodeJS.ReadableStream | string[];
  packs?: {
    include: string[];
    exclude?: string[];
    multiple?: boolean;
  }[];
}) {
  const tempDir = await mkTmpDir("path-lists");
  const includedPaths: string[] = [];
  const excludedPaths: string[] = [];
  const included: WriteStream[] = [];
  const excluded: WriteStream[] = [];
  const multipleStats: Record<string, number> = {};
  const total = new Array<number>((options.packs?.length || 0) + 1).fill(0);
  await Promise.all([
    ...new Array((options.packs?.length || 0) + 1).fill(null).map(
      (_, index) =>
        new Promise((resolve, reject) => {
          const path = join(tempDir, `${index}-included.txt`);
          const stream = createWriteStream(path);
          includedPaths.push(path);
          included.push(stream);
          stream.on("close", resolve);
          stream.on("error", reject);
        })
    ),
    ...new Array(options.packs?.length || 0).fill(null).map(
      (_, index) =>
        new Promise((resolve, reject) => {
          const path = join(tempDir, `${index}-excluded.txt`);
          const stream = createWriteStream(path);
          excludedPaths.push(path);
          excluded.push(stream);
          stream.on("close", resolve);
          stream.on("error", reject);
        })
    ),
    new Promise<void>(async (resolve) => {
      const packDirectories: [number, string][] = [];
      for await (const value of options.paths) {
        const entry = value.toString();
        const isDir = entry.endsWith("/");
        const matchEntry = isDir ? entry.slice(0, -1) : entry;
        let packIndex = 1;
        let matches = false;

        for (const pack of options.packs || []) {
          if (
            isMatch(matchEntry, pack.include) &&
            (!pack.exclude || !isMatch(matchEntry, pack.exclude))
          ) {
            if (isDir) packDirectories.push([packIndex - 1, entry]);
            included[packIndex].write(`${entry}\n`);
            if (!isDir) total[packIndex]++;
            matches = true;
            break;
          }
          packIndex++;
        }

        if (!matches) {
          const packDir = packDirectories.find(([, p]) => entry.startsWith(p));

          if (packDir) {
            const [i, v] = packDir;
            const multipleExclude = options.packs?.[i].exclude;
            if (multipleExclude && isMatch(matchEntry, multipleExclude)) {
              included[0].write(`${entry}\n`);
              excluded[i].write(`${entry}\n`);
            } else {
              if (!multipleStats[v]) multipleStats[v] = 0;
              multipleStats[v]++;
            }
          } else {
            included[0].write(`${entry}\n`);
          }
          if (!isDir) total[0]++;
        }
      }

      for (const stream of [...included, ...excluded]) {
        stream.end();
      }
      resolve();
    }),
  ]);
  return {
    path: includedPaths[0],
    includedPackPaths: includedPaths.slice(1),
    excludedPackPaths: excludedPaths,
    total: {
      all: total.reduce((p, v) => p + v, 0),
      path: total[0],
      packsPaths: total.slice(1),
      multipleStats,
    },
  };
}
