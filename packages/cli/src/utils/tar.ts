import { logExec } from "./cli";
import { countFileLines, ensureEmptyDir } from "./fs";
import { progressPercent } from "./math";
import { exec } from "./process";
import { mkdir } from "fs/promises";
import type { JSONSchema7 } from "json-schema";
import { cpus, platform } from "os";

export type Progress = {
  percent: number;
  current: number;
  total: number;
};

export type TarEntry = {
  path: string;
  progress: Progress;
};

export type CoresOptions = number | { percent: number };

export type CompressOptions = {
  level?: number;
  /**
   * @default {percent:50}
   */
  cores?: CoresOptions;
};

export type DecompressOptions = {
  /**
   * @default {percent:50}
   */
  cores?: CoresOptions;
};

export interface CreateTarOptions {
  path: string;
  verbose?: boolean;
  output: string;
  includeList: string;
  compress?: boolean | CompressOptions;
  onEntry?: (entry: TarEntry) => void;
}

export interface ExtractOptions {
  input: string;
  output: string;
  verbose?: boolean;
  decompress?: boolean | DecompressOptions;
  total?: number;
  onEntry?: (entry: TarEntry) => void;
}

export const compressDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    level: { type: "integer" },
    cores: {
      anyOf: [
        { type: "integer" },
        {
          type: "object",
          required: ["percent"],
          properties: { percent: { type: "integer" } },
        },
      ],
    },
  },
};

export type TarVendor = "busybox" | "bsdtar" | "gnu";

let tarVendor: TarVendor | undefined | null;

export async function getTarVendor(
  cache = true,
  log = false,
): Promise<TarVendor | null> {
  if (cache && typeof tarVendor !== "undefined") return tarVendor;
  const p = await exec(
    "tar",
    ["--help"],
    {},
    {
      log,
      stdout: {
        save: true,
      },
    },
  );

  const find = () => {
    if (p.stdout.includes("BusyBox")) {
      return "busybox";
    } else if (p.stdout.includes("bsdtar")) {
      return "bsdtar";
    } else if (p.stdout.includes("GNU")) {
      return "gnu";
    } else {
      return null;
    }
  };

  return (tarVendor = find());
}

export type ListTarOptions = {
  input: string;
  onEntry?: (entry: Pick<TarEntry, "path">) => void;
  verbose?: boolean;
};

export async function listTar(options: ListTarOptions) {
  let total = 0;
  await exec(
    "tar",
    ["-tf", toLocalPath(options.input), "--force-local"],
    {},
    {
      log: options.verbose,
      stdout: {
        parseLines: "skip-empty",
        onData: (path) => {
          options.onEntry?.({ path });
          total++;
        },
      },
    },
  );
  return total;
}

let pigzLib: boolean | undefined;

export async function checkPigzLib(cache = true) {
  if (cache && pigzLib !== undefined) return pigzLib;
  try {
    return !(await exec("pigz", ["-V"])).exitCode;
  } catch {
    return false;
  }
}

async function resolveCores(input: undefined | number | { percent: number }) {
  if (!(await checkPigzLib())) return 1;
  const total = cpus().length;
  return Math.min(
    total,
    typeof input === "number"
      ? input
      : Math.max(0, Math.round(((input?.percent || 50) * total) / 100)),
  );
}

async function ifX<T, R>(
  input: T | undefined | boolean,
  cb: (input: T) => Promise<R>,
): Promise<R | undefined> {
  return input ? await cb((input === true ? {} : input) as any) : undefined;
}

export async function createTar(options: CreateTarOptions) {
  const vendor = await getTarVendor(true, options.verbose);
  const total = await countFileLines(options.includeList);
  const compress = await ifX(options.compress, async (compress) => ({
    ...compress,
    cores: await resolveCores(compress.cores),
  }));

  let current = 0;

  const env = {
    ...(compress?.cores === 1 &&
      compress.level && {
        GZIP_OPT: compress.level.toString(),
      }),
  };

  await exec(
    "tar",
    [
      "-C",
      toLocalPath(options.path),
      compress?.cores === 1 ? "-czvf" : "-cvf",
      toLocalPath(options.output),
      "-T",
      toLocalPath(options.includeList),
      "--ignore-failed-read",
      "--force-local",
      ...(compress && compress.cores > 1
        ? [
            `-I="pigz --recursive ${[
              !!compress.level && `-${compress.level}`,
              `-p ${resolveCores(compress.cores)}`,
            ]
              .filter(Boolean)
              .join(" ")}"`,
          ]
        : []),
    ],
    {
      env: {
        ...process.env,
        ...env,
      },
    },
    {
      log: options.verbose ? { envNames: Object.keys(env) } : false,
      stderr: { toExitCode: true },
      stdout: {
        parseLines: "skip-empty",
        onData: (line) => {
          current++;
          const path = vendor === "bsdtar" ? line.slice(2) : line;
          options.onEntry?.({
            path,
            progress: {
              total,
              current,
              percent: progressPercent(total, current),
            },
          });
        },
      },
    },
  );
}

/**
 * Fix `tar.exe: Option --force-local is not supported`
 */
function toLocalPath(path: string) {
  return platform() === "win32" ? path.replace(/\\/g, "/") : path;
}

export async function extractTar(options: ExtractOptions) {
  let total =
    options.total ??
    (await listTar({ input: options.input, verbose: options.verbose }));

  if (options.verbose) logExec("mkdir", ["-p", options.output]);

  await mkdir(options.output, { recursive: true });
  await ensureEmptyDir(options.output);

  const decompress = await ifX(options.decompress, async (decompress) => ({
    ...decompress,
    cores: await resolveCores(decompress.cores),
  }));

  let current = 0;
  await exec(
    "tar",
    [
      decompress?.cores === 1 ? "-xzvpf" : "-xvpf",
      toLocalPath(options.input),
      "-C",
      toLocalPath(options.output),
      "--force-local",
      ...(decompress && decompress.cores > 1
        ? [`-I="pigz -p ${resolveCores(decompress.cores)}`]
        : []),
    ],
    {},
    {
      log: options.verbose,
      stderr: {
        toExitCode: true,
      },
      stdout: {
        parseLines: "skip-empty",
        onData: (path) => {
          current++;
          options.onEntry?.({
            path,
            progress: {
              total,
              current,
              percent: progressPercent(total, current),
            },
          });
        },
      },
    },
  );
}
