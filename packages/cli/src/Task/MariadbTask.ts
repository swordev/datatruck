import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../utils/cli";
import {
  forEachFile,
  mkdirIfNotExists,
  readDir,
  waitForClose,
} from "../utils/fs";
import { progressPercent } from "../utils/math";
import { createProcess, exec } from "../utils/process";
import { extractTar } from "../utils/tar";
import { BackupDataType, RestoreDataType, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { createReadStream, createWriteStream } from "fs";
import { readFile, rm, writeFile } from "fs/promises";
import { JSONSchema7 } from "json-schema";
import { cpus } from "os";
import { join } from "path";

export type MariadbTaskConfigType = {
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

export const mariadbTaskDefinition: JSONSchema7 = {
  type: "object",
  required: ["hostname", "username", "password"],
  additionalProperties: false,
  properties: {
    command: { type: "string" },
    hostname: { type: "string" },
    username: { type: "string" },
    password: {
      anyOf: [
        {
          type: "string",
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: { type: "string" },
          },
        },
      ],
    },
    includeTables: makeRef(DefinitionEnum.stringListUtil),
    excludeTables: makeRef(DefinitionEnum.stringListUtil),
    includeDatabases: makeRef(DefinitionEnum.stringListUtil),
    excludeDatabases: makeRef(DefinitionEnum.stringListUtil),
    parallel: {
      anyOf: [{ type: "integer", minimum: 1 }, { enum: ["auto"] }],
    },
    compress: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            command: { type: "string" },
            args: makeRef(DefinitionEnum.stringListUtil),
          },
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { enum: ["gzip", "pigz"] },
            args: makeRef(DefinitionEnum.stringListUtil),
          },
        },
      ],
    },
  },
};

function normalizeConfig(
  input: Pick<MariadbTaskConfigType, "compress" | "parallel">,
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

export class MariadbTask extends TaskAbstract<MariadbTaskConfigType> {
  protected verbose?: boolean;
  private get command() {
    return this.config.command ?? "mariabackup";
  }
  override async onBeforeBackup() {
    return {
      targetPath: await this.mkTmpDir(MariadbTask.name),
    };
  }
  override async onBackup(data: BackupDataType) {
    this.verbose = data.options.verbose;
    const config = this.config;
    const command = this.command;

    const sourcePath = data.package.path;
    const targetPath = data.targetPath;

    ok(typeof sourcePath === "string");
    ok(typeof targetPath === "string");

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
      args.push(`--target-dir=${targetPath}`);
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

    let p1: ReturnType<typeof createProcess>;
    let lastLineText: string | undefined;
    const pathRegex = /((Copying|Streaming) .+) to/;

    const onData = async (line: string) => {
      const { text } = parseLine(line);
      lastLineText = text;

      if (
        line.includes("[ERROR] InnoDB: Unsupported redo log format.") ||
        line.includes("Error: cannot read redo log header")
      ) {
        p1!.kill();
      } else {
        const matches = pathRegex.exec(text);
        if (matches) current++;
        await data.onProgress({
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
    await writeFile(join(targetPath, "stats.dtt.json"), JSON.stringify(stats));

    if (compress) {
      const p0 = createWriteStream(join(targetPath, "db.xb.gz"));
      p1 = createProcess(command, args, {
        $log: {
          exec: this.verbose,
          stderr: this.verbose,
        },
        $stderr: {
          parseLines: true,
          onData,
        },
        $onExitCode: (code) => `Exit code: ${code} - ${lastLineText}`,
      });
      const p2 = createProcess(compress.command, compress.args);

      p1.stdout.pipe(p2.stdin, { end: true });
      p2.stdout.pipe(p0, { end: true });

      await Promise.all([p1, p2, waitForClose(p0)]);
    } else {
      p1 = createProcess(command, args, {
        $log: this.verbose,
        $stdout: {
          parseLines: true,
          onData,
        },
        $stderr: {
          parseLines: true,
          onData,
        },
        $onExitCode: (code) => `Exit code: ${code} - ${lastLineText}`,
      });

      await p1;

      await exec(
        command,
        [`--prepare`, `--target-dir=${targetPath}`],
        undefined,
        {
          log: this.verbose,
          stderr: { onData: () => {} },
        },
      );
    }
  }

  override async onRestore(data: RestoreDataType) {
    this.verbose = data.options.verbose;

    const restorePath = data.package.restorePath;
    ok(typeof restorePath === "string");

    await mkdirIfNotExists(restorePath);

    const removeFiles: string[] = [];
    let files: string[] = [];
    const reloadFiles = async (
      data: { removeFile?: string } = {},
    ): Promise<string[]> => {
      if (data.removeFile) removeFiles.push(data.removeFile);
      return (files = (await readDir(restorePath)).filter(
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
      const statsFilePath = join(restorePath, statsFile);
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

      await data.onProgress({
        absolute,
      });

      await extractTar({
        input: join(restorePath, zipFile),
        output: restorePath,
        verbose: this.verbose,
        async onEntry(item) {
          await data.onProgress({
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
      const xbFilePath = join(restorePath, xbFile);
      const xbStream = createReadStream(xbFilePath);

      removeFiles.push(xbFile);
      absolute.description = "Extracting stream";
      absolute.payload = xbFile;

      await data.onProgress({
        absolute,
      });

      let currentXbFiles = 0;

      const { parallel } = normalizeConfig({ parallel: this.config.parallel });

      const p1 = createProcess(
        "mbstream",
        ["-x", "-C", restorePath, "-v", "-p", parallel],
        {
          $log: this.verbose,
          $stderr: {
            parseLines: true,
            async onData(line) {
              const { text: path } = parseLine(line);
              await data.onProgress({
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
            },
          },
        },
      );

      xbStream.pipe(p1.stdin, { end: true });

      await Promise.all([waitForClose(xbStream), p1]);
    }

    // Prepare

    absolute.current++;
    absolute.percent = progressPercent(absolute.total, absolute.current);

    if (files.length === 1 && xbFile) {
      absolute.description = "Preparing";

      await data.onProgress({
        absolute,
      });

      await exec(
        this.command,
        [`--prepare`, `--target-dir=${restorePath}`],
        undefined,
        {
          log: this.verbose,
          stderr: { onData: () => {} },
        },
      );
    }

    await reloadFiles();

    removeFiles.push(...files.filter((file) => file.startsWith("ib_logfile")));

    // Remove files

    for (const file of removeFiles) {
      const filePath = join(restorePath, file);
      if (this.verbose) logExec("rm", [filePath]);
      await rm(filePath);
    }
  }
}
