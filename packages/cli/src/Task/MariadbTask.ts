import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { logExec } from "../util/cli-util";
import {
  forEachFile,
  mkdirIfNotExists,
  mkTmpDir,
  readDir,
} from "../util/fs-util";
import { progressPercent } from "../util/math-util";
import { exec } from "../util/process-util";
import { BackupDataType, RestoreDataType, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { ChildProcess } from "child_process";
import { readFile, rm } from "fs/promises";
import { JSONSchema7 } from "json-schema";
import { join } from "path";
import { normalize } from "path/posix";

export type MariadbTaskConfigType = {
  command?: string;
  hostname: string;
  username: string;
  password: string | { path: string };
  includeTables?: string[];
  excludeTables?: string[];
  includeDatabases?: string[];
  excludeDatabases?: string[];
};

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
  },
};

export class MariadbTask extends TaskAbstract<MariadbTaskConfigType> {
  protected verbose?: boolean;
  private get command() {
    return this.config.command ?? "mariabackup";
  }
  override async onBeforeBackup() {
    return {
      targetPath: await mkTmpDir(MariadbTask.name),
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

    const args = [
      `--backup`,
      `--datadir=${sourcePath}`,
      `--target-dir=${targetPath}`,
      `--host=${config.hostname}`,
      `--user=${config.username}`,
      `--password=${
        typeof config.password === "string"
          ? config.password
          : config.password
          ? (await readFile(config.password.path)).toString()
          : ""
      }`,
    ];

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

    let childProcess: ChildProcess | undefined;

    const onData = async (strLines: string) => {
      const paths: string[] = [];
      const pathRegex =
        /\[\d{1,}\] \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Copying (.+) to/;
      const lines = strLines.split(/\r?\n/);
      let fatalError = false;
      for (const line of lines) {
        if (
          line.includes("[ERROR] InnoDB: Unsupported redo log format.") ||
          line.includes("Error: cannot read redo log header")
        ) {
          fatalError = true;
        } else {
          const matches = pathRegex.exec(line);
          if (matches) {
            current++;
            paths.push(matches[1]);
          }
        }
      }

      if (fatalError) {
        childProcess!.kill();
      } else if (paths.length) {
        const path = normalize(paths[0]);
        await data.onProgress({
          relative: {
            description: "Copying file",
            payload: path,
          },
          absolute: {
            current,
            percent: progressPercent(total, current),
            total,
          },
        });
      }
    };

    await exec(command, args, undefined, {
      log: this.verbose,
      onSpawn: (p) => {
        childProcess = p;
      },
      stdout: {
        onData,
      },
      stderr: {
        onData,
      },
    });

    await exec(
      command,
      [`--prepare`, `--target-dir=${targetPath}`],
      undefined,
      {
        log: this.verbose,
        stderr: { onData: () => {} },
      }
    );
  }

  override async onRestore(data: RestoreDataType) {
    this.verbose = data.options.verbose;

    const restorePath = data.package.restorePath;
    ok(typeof restorePath === "string");

    await mkdirIfNotExists(restorePath);

    const files = await readDir(restorePath);

    for (const file of files) {
      if (file.startsWith("ib_logfile")) {
        const filePath = join(restorePath, file);
        if (this.verbose) logExec("rm", [filePath]);
        await rm(filePath);
      }
    }
  }
}
