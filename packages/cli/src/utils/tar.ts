import { logExec } from "./cli";
import { countFileLines, ensureEmptyDir } from "./fs";
import { progressPercent } from "./math";
import { exec } from "./process";
import { mkdir } from "fs/promises";
import { platform } from "os";

export type Progress = {
  percent: number;
  current: number;
  total: number;
};

export type TarEntry = {
  path: string;
  progress: Progress;
};

export interface CreateTarOptions {
  path: string;
  verbose?: boolean;
  output: string;
  includeList: string;
  compress?: boolean;
  onEntry?: (entry: TarEntry) => void;
}

export interface ExtractOptions {
  input: string;
  output: string;
  verbose?: boolean;
  uncompress?: boolean;
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

export async function createTar(options: CreateTarOptions) {
  const vendor = await getTarVendor(true, options.verbose);
  const total = await countFileLines(options.includeList);
  let current = 0;
  await exec(
    "tar",
    [
      "-C",
      toLocalPath(options.path),
      options.compress ? "-czvf" : "-cvf",
      toLocalPath(options.output),
      "-T",
      toLocalPath(options.includeList),
      "--ignore-failed-read",
      "--force-local",
    ],
    {},
    {
      log: options.verbose,
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

  let current = 0;
  await exec(
    "tar",
    [
      options.uncompress ? "-xzvpf" : "-xvpf",
      toLocalPath(options.input),
      "-C",
      toLocalPath(options.output),
      "--force-local",
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
