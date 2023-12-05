import { AppError } from "../Error/AppError";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { resolveDatabaseName } from "../utils/datatruck/config";
import { readDir } from "../utils/fs";
import { exec } from "../utils/process";
import { mkTmpDir } from "../utils/temp";
import { TaskBackupData, TaskRestoreData, TaskAbstract } from "./TaskAbstract";
import { readFile } from "fs/promises";
import { JSONSchema7 } from "json-schema";
import { isMatch } from "micromatch";
import { join } from "path";

export type MssqlTaskConfig = {
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

export class MssqlTask extends TaskAbstract<MssqlTaskConfig> {
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

  override async backup(data: TaskBackupData) {
    this.verbose = data.options.verbose;

    if (data.package.path)
      throw new Error(`Path is not required: ${data.package.path}`);

    const snapshotPath = await mkTmpDir(
      mssqlTaskName,
      "task",
      "backup",
      "snapshot",
    );

    const databaseNames = (await this.fetchDatabaseNames()).filter(
      (databaseName) =>
        (!this.config.includeDatabases ||
          isMatch(databaseName, this.config.includeDatabases)) &&
        (!this.config.excludeDatabases ||
          !isMatch(databaseName, this.config.excludeDatabases)),
    );

    for (const databaseName of databaseNames) {
      const databasePath = join(
        snapshotPath,
        `${databaseName}${MssqlTask.SUFFIX}`,
      );
      await this.exec(
        `BACKUP DATABASE [${databaseName}] TO DISK='${databasePath}' WITH FORMAT`,
      );
    }
    return { snapshotPath };
  }

  override async restore(data: TaskRestoreData) {
    this.verbose = data.options.verbose;
    const snapshotPath = data.snapshotPath;
    const files = await readDir(snapshotPath);

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
      const databasePath = join(snapshotPath, file);
      const exists = await this.fetchDatabaseNames(databaseName);
      if (exists.length)
        throw new AppError(`Target database already exists: ${databaseName}`);

      await this.exec(
        `RESTORE DATABASE [${databaseName}] FROM disk='${databasePath}'`,
      );
    }
  }
}
