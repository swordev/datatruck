import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { resolveDatabaseName } from "../utils/datatruck/config";
import { mkdirIfNotExists, readDir } from "../utils/fs";
import { exec } from "../utils/process";
import { BackupDataType, RestoreDataType, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { readFile } from "fs/promises";
import { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { join } from "path";

export type MssqlTaskConfigType = {
  command?: string;
  hostname?: string;
  username?: string;
  passwordFile?: string;
  targetDatabase?: string;
  includeDatabases?: string[];
  excludeDatabases?: string[];
};

export const mssqlTaskName = "mssql";

export const mssqlTaskDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  properties: {
    command: { type: "string" },
    hostname: { type: "string" },
    username: { type: "string" },
    passwordFile: { type: "string" },
    includeDatabases: makeRef(DefinitionEnum.stringListUtil),
    excludeDatabases: makeRef(DefinitionEnum.stringListUtil),
  },
};

export class MssqlTask extends TaskAbstract<MssqlTaskConfigType> {
  static SUFFIX = ".BAK";
  protected verbose?: boolean;
  private get command() {
    return this.config.command ?? "sqlcmd";
  }

  async exec(query: string) {
    const result = await exec(
      this.command,
      [
        ...(this.config.hostname ? ["-S", this.config.hostname] : []),
        ...(this.config.username ? ["-U", this.config.username] : []),
        ...(this.config.passwordFile
          ? ["-P", (await readFile(this.config.passwordFile)).toString()]
          : []),
        "-E",
        "-W",
        "-s",
        ",",
        "-w",
        "999",
        "-Q",
        `SET nocount ON; ${query.replace(/[\n\t]/g, " ")}`,
      ],
      undefined,
      {
        log: this.verbose,
        stderr: {
          toExitCode: true,
        },
        stdout: {
          save: true,
        },
      },
    );
    return result.stdout
      .split(/\n/g)
      .map((row) => row.split(","))
      .filter((row) => row.length);
  }

  async fetchDatabaseNames(name?: string) {
    const query = `SELECT name FROM master.dbo.sysdatabases ${
      name ? `WHERE name = '${name}'` : ""
    }`;
    const rows = await this.exec(query);
    const privateDatabases = ["master", "tempdb", "model", "msdb"];
    return rows
      .map(([database]) => database)
      .filter((database) => !privateDatabases.includes(database));
  }

  override async onBackup(data: BackupDataType) {
    this.verbose = data.options.verbose;
    const targetPath = data.package.path;
    ok(typeof targetPath === "string");

    const databaseNames = (await this.fetchDatabaseNames()).filter(
      (databaseName) =>
        (!this.config.includeDatabases ||
          isMatch(databaseName, this.config.includeDatabases)) &&
        (!this.config.excludeDatabases ||
          !isMatch(databaseName, this.config.excludeDatabases)),
    );

    await mkdirIfNotExists(targetPath);

    for (const databaseName of databaseNames) {
      const databasePath = join(
        targetPath,
        `${databaseName}${MssqlTask.SUFFIX}`,
      );
      await this.exec(
        `BACKUP DATABASE [${databaseName}] TO DISK='${databasePath}' WITH FORMAT`,
      );
    }
  }

  override async onRestore(data: RestoreDataType) {
    this.verbose = data.options.verbose;
    const restorePath = data.package.restorePath;

    ok(typeof restorePath === "string");

    await mkdirIfNotExists(restorePath);

    const files = await readDir(restorePath);

    for (const file of files) {
      if (!file.endsWith(MssqlTask.SUFFIX)) continue;
      let databaseName = file.slice(0, MssqlTask.SUFFIX.length * -1);
      if (this.config.targetDatabase)
        databaseName = resolveDatabaseName(this.config.targetDatabase, {
          action: "restore",
          database: databaseName,
          packageName: data.package.name,
          snapshotId: data.options.snapshotId,
          snapshotDate: data.snapshot.date,
        });
      const databasePath = join(restorePath, file);
      const exists = await this.fetchDatabaseNames(databaseName);
      if (exists.length)
        throw new AppError(`Target database already exists: ${databaseName}`);

      await this.exec(
        `RESTORE DATABASE [${databaseName}] FROM disk='${databasePath}'`,
      );
    }
  }
}
