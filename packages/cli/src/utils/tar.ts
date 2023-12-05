import { logExec } from "./cli";
import { countFileLines, existsDir } from "./fs";
import { progressPercent } from "./math";
import { exec } from "./process";
import { BasicProgress } from "./progress";
import { mkdir } from "fs/promises";
import { cpus, platform } from "os";

export type TarEntry = {
  path: string;
  progress: BasicProgress;
};

export type CoresOptions = number | { percent: number };

export type CompressOptions = {
  level?: number;
  cores?: CoresOptions;
};

export type DecompressOptions = {
  cores?: CoresOptions;
};

export type CreateTarOptions = {
  path: string;
  verbose?: boolean;
  output: string;
  compress?: boolean | CompressOptions;
  onEntry?: (entry: TarEntry) => void;
} & (
  | {
      includeList: string;
    }
  | {
      include: string[];
    }
);

export interface ExtractOptions {
  input: string;
  output: string;
  verbose?: boolean;
  decompress?: boolean | DecompressOptions;
  total?: number;
  onEntry?: (entry: TarEntry) => void;
}

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
  const vendor = await getTarVendor(true, options.verbose);
  let total = 0;
  await exec(
    "tar",
    [
      "-tf",
      toLocalPath(options.input),
      ...(vendor === "bsdtar" ? [] : ["--force-local"]),
    ],
    {},
    {
      log: options.verbose,
      stdout: {
        parseLines: "skip-empty",
        onData: (path) => {
          options.onEntry?.({ path: normalizeTarPath(path) });
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
  const total =
    "include" in options
      ? options.include.length
      : await countFileLines(options.includeList);
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

  const onData = (line: string) => {
    current++;
    let path = vendor === "bsdtar" ? line.slice(2) : line;
    options.onEntry?.({
      path: normalizeTarPath(path),
      progress: {
        total,
        current,
        percent: progressPercent(total, current),
      },
    });
  };

  await exec(
    "tar",
    [
      "--no-recursion",
      "-C",
      toLocalPath(options.path),
      compress?.cores === 1 ? "-czvf" : "-cvf",
      toLocalPath(options.output),
      // https://bugs.freebsd.org/bugzilla/show_bug.cgi?id=172293
      ...(vendor === "bsdtar" ? [] : ["--ignore-failed-read"]),
      ...(vendor === "bsdtar" ? [] : ["--force-local"]),
      ...(compress && compress.cores > 1
        ? [
            "-I",
            `"${[
              "pigz",
              "-r",
              !!compress.level && `-${compress.level}`,
              `-p ${compress.cores}`,
            ]
              .filter(Boolean)
              .join(" ")}"`,
          ]
        : []),

      ...("includeList" in options
        ? ["-T", toLocalPath(options.includeList)]
        : ["--", ...options.include]),
    ],
    {
      ...(compress &&
        compress.cores > 1 && {
          shell: true,
        }),
      env: {
        ...process.env,
        ...env,
      },
    },
    {
      log: options.verbose
        ? { envNames: Object.keys(env), exec: true, stderr: true, stdout: true }
        : false,
      ...(vendor === "bsdtar"
        ? {
            stderr: options.onEntry
              ? { toExitCode: true, parseLines: "skip-empty", onData }
              : { toExitCode: true },
          }
        : {
            stderr: { toExitCode: true },
            stdout: { parseLines: "skip-empty", onData },
          }),
    },
  );
}

/**
 * Fix `tar.exe: Option --force-local is not supported`
 */
function toLocalPath(path: string) {
  return platform() === "win32" ? path.replace(/\\/g, "/") : path;
}

/**
 * bsdtar (only windows?) fails if path ends with slash
 */
export function normalizeTarPath(path: string) {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export async function extractTar(options: ExtractOptions) {
  let total = options.onEntry
    ? options.total ??
      (await listTar({ input: options.input, verbose: options.verbose }))
    : undefined;

  if (!(await existsDir(options.output))) {
    if (options.verbose) logExec("mkdir", ["-p", options.output]);
    await mkdir(options.output, { recursive: true });
  }

  const decompress = await ifX(options.decompress, async (decompress) => ({
    ...decompress,
    cores: await resolveCores(decompress.cores),
  }));

  let current = 0;
  const vendor = await getTarVendor(true, options.verbose);
  const onData = (line: string) => {
    const path = vendor === "bsdtar" ? line.slice(2) : line;
    current++;
    options.onEntry?.({
      path: normalizeTarPath(path),
      progress: {
        total: total!,
        current,
        percent: progressPercent(total!, current),
      },
    });
  };
  await exec(
    "tar",
    [
      decompress?.cores === 1 ? "-xzvpf" : "-xvpf",
      toLocalPath(options.input),
      "-C",
      toLocalPath(options.output),
      ...(vendor === "bsdtar" ? [] : ["--force-local"]),
      ...(decompress && decompress.cores > 1
        ? ["-I", `"pigz -p ${decompress.cores}"`]
        : []),
    ],
    {
      ...(decompress &&
        decompress.cores > 1 && {
          shell: true,
        }),
    },
    {
      log: options.verbose,
      ...(vendor === "bsdtar"
        ? {
            stderr: options.onEntry
              ? { toExitCode: true, parseLines: "skip-empty", onData }
              : { toExitCode: true },
          }
        : {
            stderr: { toExitCode: true },
            stdout: { parseLines: "skip-empty", onData },
          }),
    },
  );
}
