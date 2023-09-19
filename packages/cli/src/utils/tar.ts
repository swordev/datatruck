import { logExec } from "./cli";
import { ensureEmptyDir } from "./fs";
import { progressPercent } from "./math";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import tar from "tar";

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
  include: string[];
  compress?: boolean;
  onEntry?: (entry: TarEntry) => void;
}

export interface ExtractOptions {
  input: string;
  output: string;
  verbose?: boolean;
  total?: number;
  onEntry?: (entry: TarEntry) => void;
}

export type ListTarOptions = {
  input: string;
  onEntry?: (entry: Pick<TarEntry, "path">) => void;
  verbose?: boolean;
};

export async function listTar(options: ListTarOptions) {
  if (options.verbose) logExec("tar", ["-ztvf", options.input]);
  let total = 0;
  await tar.list({
    file: options.input,
    onentry(entry) {
      options.onEntry?.({ path: entry.path });
      total++;
    },
  });
  return total;
}

export async function createTar(options: CreateTarOptions) {
  if (options.verbose)
    logExec("tar", [
      options.compress ? "-czvf" : "-cvf",
      options.output,
      options.path,
    ]);
  let total = options.include.length;
  if (!total) throw new Error("'include' option is empty");
  let current = 0;
  let progressPromise: Promise<void> | undefined;
  const inStream = tar.create(
    {
      gzip: options.compress,
      cwd: options.path,
      filter(path) {
        current++;
        options.onEntry?.({
          path: path,
          progress: {
            total,
            current,
            percent: progressPercent(total, current),
          },
        });
        return true;
      },
    },
    options.include
  );

  const outStream = createWriteStream(options.output);

  await new Promise<void>((resolve, reject) => {
    inStream.on("error", reject);
    outStream.on("error", reject);
    inStream.pipe(outStream);
    outStream.on("close", resolve);
  });

  await progressPromise;
}

export async function extractTar(options: ExtractOptions) {
  let total =
    options.total ??
    (await listTar({ input: options.input, verbose: options.verbose }));
  if (options.verbose) {
    logExec("tar", ["-xzvfp", options.input, "-C", options.output]);
    logExec("mkdir", ["-p", options.output]);
  }
  let current = 0;

  await mkdir(options.output, { recursive: true });
  await ensureEmptyDir(options.output);

  await tar.extract({
    file: options.input,
    cwd: options.output,
    preserveOwner: true,
    onentry(entry) {
      current++;
      options.onEntry?.({
        path: entry.path,
        progress: {
          total,
          current,
          percent: progressPercent(total, current),
        },
      });
    },
  });
}
