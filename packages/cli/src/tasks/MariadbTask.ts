import { AsyncProcess } from "../utils/async-process";
import { logExec } from "../utils/cli";
import { forEachFile, safeReaddir } from "../utils/fs";
import { progressPercent } from "../utils/math";
import { extractTar } from "../utils/tar";
import { mkTmpDir } from "../utils/temp";
import { TaskBackupData, TaskRestoreData, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { createReadStream, createWriteStream } from "fs";
import { readFile, rm, writeFile } from "fs/promises";
import { cpus } from "os";
import { join } from "path";

export type MariadbTaskConfig = {
  command?: string;
  hostname: string;
  username: string;
  password: string | { path: string };
  includeTables?: string[];
  excludeTables?: string[];
  includeDatabases?: string[];
  excludeDatabases?: string[];
  /**
   * @default "auto"
   */
  parallel?: number | "auto";
  compress?:
    | {
        command: string;
        args?: string[];
      }
    | {
        type: "gzip" | "pigz";
        args?: string[];
      };
};

type Stats = { xbFiles?: number };

export const mariadbTaskName = "mariadb";

function normalizeConfig(
  input: Pick<MariadbTaskConfig, "compress" | "parallel">,
) {
  let parallel = input.parallel ?? "auto";
  let cores = cpus().length;

  if (parallel === "auto") {
    parallel = input.compress ? Math.round(cores / 2) : cores;
    cores = Math.max(1, cores - parallel);
  }

  let compress: { command: string; args?: string[] } | undefined;

  if (input.compress && "type" in input.compress) {
    if (input.compress.type === "pigz") {
      compress = { command: "pigz", args: [] };
      if (!input.compress.args?.includes("-p")) {
        compress.args!.push("-p", cores.toString());
      }
    } else if (input.compress.type === "gzip") {
      compress = { command: "gzip" };
    }
  } else {
    compress = input.compress;
  }

  return { parallel, compress };
}
const parseLineRegex =
  /^(?:\[(?<step>\d+)\] )?(?<dateTime>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})?\s+(?<text>.+)\s*$/;

function parseLine(line: string): {
  step?: string;
  dateTime?: string;
  text: string;
} {
  const result = parseLineRegex.exec(line);

  if (result) {
    return result.groups as any;
  } else {
    return { text: line };
  }
}

export class MariadbTask extends TaskAbstract<MariadbTaskConfig> {
  protected verbose?: boolean;
  private get command() {
    return this.config.command ?? "mariabackup";
  }
  override async backup(data: TaskBackupData) {
    this.verbose = data.options.verbose;
    const config = this.config;
    const command = this.command;

    const sourcePath = data.package.path;
    const snapshotPath = await mkTmpDir(
      mariadbTaskName,
      "task",
      "backup",
      "snapshot",
    );

    ok(typeof sourcePath === "string");

    const { parallel, compress } = normalizeConfig(config);

    const args = [
      `--backup`,
      `--datadir=${sourcePath}`,
      `--host=${config.hostname}`,
      `--user=${config.username}`,
      `--parallel=${parallel}`,
      `--password=${
        typeof config.password === "string"
          ? config.password
          : config.password
            ? (await readFile(config.password.path)).toString()
            : ""
      }`,
    ];

    if (compress) {
      args.push(`--stream=xbstream`);
    } else {
      args.push(`--target-dir=${snapshotPath}`);
    }

    if (config.includeDatabases)
      args.push(`--databases=${config.includeDatabases.join(" ")}`);

    if (config.excludeDatabases)
      args.push(`--databases-exclude=${config.excludeDatabases.join(" ")}`);

    if (config.includeTables)
      args.push(`--tables=^(${config.includeTables.join("|")})$`);

    if (config.excludeTables)
      args.push(`--tables-exclude=^(${config.excludeTables.join("|")})$`);

    let total = 0;
    let current = 0;

    await forEachFile(sourcePath, () => {
      total++;
    });

    let lastLineText: string | undefined;
    const controller = new AbortController();
    const pathRegex = /((Copying|Streaming) .+) to/;

    const onData = async (line: string) => {
      const { text } = parseLine(line);
      lastLineText = text;

      if (
        line.includes("[ERROR] InnoDB: Unsupported redo log format.") ||
        line.includes("Error: cannot read redo log header")
      ) {
        controller.abort();
      } else {
        const matches = pathRegex.exec(text);
        if (matches) current++;
        data.onProgress({
          relative: {
            payload: matches ? matches[1] : text,
          },
          absolute: {
            current,
            percent: progressPercent(total, current),
            total,
          },
        });
      }
    };

    const stats: Stats = { xbFiles: total };
    await writeFile(
      join(snapshotPath, "stats.dtt.json"),
      JSON.stringify(stats),
    );

    if (compress) {
      const fileStream = createWriteStream(join(snapshotPath, "db.xb.gz"));
      const dumpProcess = new AsyncProcess(command, args, {
        $log: {
          exec: this.verbose,
          stderr: this.verbose,
        },
        $controller: controller,
        $exitCode: (code) => `Exit code: ${code} - ${lastLineText}`,
      });
      const compressProcess = new AsyncProcess(compress.command, compress.args);

      await Promise.all([
        dumpProcess.stdout.pipe(compressProcess.stdin),
        dumpProcess.stderr.parseLines(onData),
        compressProcess.stdout.pipe(fileStream),
      ]);
    } else {
      const dumpProcess = new AsyncProcess(command, args, {
        $log: this.verbose,
        $controller: controller,
        $exitCode: (code) => `Exit code: ${code} - ${lastLineText}`,
      });

      await Promise.all([
        dumpProcess.stdout.parseLines(onData),
        dumpProcess.stderr.parseLines(onData),
      ]);

      const prepareProcess = new AsyncProcess(
        command,
        [`--prepare`, `--target-dir=${snapshotPath}`],
        { $log: this.verbose },
      );

      await prepareProcess.waitForClose();
    }
    return { snapshotPath };
  }

  override async restore(data: TaskRestoreData) {
    this.verbose = data.options.verbose;
    const snapshotPath = data.snapshotPath;

    const removeFiles: string[] = [];
    let files: string[] = [];
    const reloadFiles = async (
      data: { removeFile?: string } = {},
    ): Promise<string[]> => {
      if (data.removeFile) removeFiles.push(data.removeFile);
      return (files = (await safeReaddir(snapshotPath)).filter(
        (v) => !removeFiles.includes(v),
      ));
    };

    await reloadFiles();

    const absolute = {
      format: "amount" as const,
      total: 3,
      current: 0,
      description: undefined as string | undefined,
      payload: undefined as string | undefined,
      percent: undefined as number | undefined,
    };

    // Stats

    const statsFile = files.find((file) => file === "stats.dtt.json");
    let stats: Stats | undefined;

    if (statsFile) {
      const statsFilePath = join(snapshotPath, statsFile);
      const statsBuffer = await readFile(statsFilePath);
      stats = JSON.parse(statsBuffer.toString());
      await reloadFiles({ removeFile: statsFile });
    }

    const zipFile = files.find((file) => file.endsWith(".gz"));

    absolute.current++;
    absolute.percent = progressPercent(absolute.total, absolute.current);

    // Extract

    if (files.length === 1 && zipFile) {
      absolute.description = "Extracting";
      absolute.payload = zipFile;

      data.onProgress({
        absolute,
      });

      await extractTar({
        input: join(snapshotPath, zipFile),
        decompress: true,
        output: snapshotPath,
        verbose: this.verbose,
        onEntry(item) {
          data.onProgress({
            absolute,
            relative: {
              payload: item.path,
              format: "amount",
              percent: item.progress.percent,
            },
          });
        },
      });
      await reloadFiles({ removeFile: zipFile });
    }

    // Extract stream

    const xbFile = files.find((file) => file.endsWith(".xb"));

    absolute.current++;
    absolute.percent = progressPercent(absolute.total, absolute.current);

    if (files.length === 1 && xbFile) {
      const xbFilePath = join(snapshotPath, xbFile);
      const xbStream = createReadStream(xbFilePath);

      removeFiles.push(xbFile);
      absolute.description = "Extracting stream";
      absolute.payload = xbFile;

      data.onProgress({
        absolute,
      });

      let currentXbFiles = 0;

      const { parallel } = normalizeConfig({ parallel: this.config.parallel });

      const p1 = new AsyncProcess(
        "mbstream",
        ["-x", "-C", snapshotPath, "-v", "-p", parallel],
        { $log: this.verbose },
      );

      await Promise.all([
        p1.stdin.pipe(xbStream),
        p1.stderr.parseLines((line) => {
          const { text: path } = parseLine(line);
          data.onProgress({
            absolute,
            relative: {
              payload: path,
              format: "amount",
              current: ++currentXbFiles,
              total: stats?.xbFiles,
              percent: stats?.xbFiles
                ? progressPercent(stats.xbFiles, currentXbFiles)
                : undefined,
            },
          });
        }),
      ]);
    }

    // Prepare

    absolute.current++;
    absolute.percent = progressPercent(absolute.total, absolute.current);

    if (files.length === 1 && xbFile) {
      absolute.description = "Preparing";

      data.onProgress({
        absolute,
      });

      const p = new AsyncProcess(
        this.command,
        [`--prepare`, `--target-dir=${snapshotPath}`],
        { $log: this.verbose },
      );

      await p.waitForClose();
    }

    await reloadFiles();

    removeFiles.push(...files.filter((file) => file.startsWith("ib_logfile")));

    // Remove files

    for (const file of removeFiles) {
      const filePath = join(snapshotPath, file);
      if (this.verbose) logExec("rm", [filePath]);
      await rm(filePath);
    }
  }
}
