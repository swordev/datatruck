import { BackupCommandOptions } from "../../commands/BackupCommand";
import { CopyCommandOptions } from "../../commands/CopyCommand";
import { PruneCommandOptions } from "../../commands/PruneCommand";
import { AsyncProcess } from "../async-process";
import { logJson, stringifyOptions } from "../cli";
import { safeRename } from "../fs";
import { datatruckCommandMap } from "./command";
import { defaultsLogPath } from "./cron-server";
import { WriteStream, createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";

export type JobScheduleObject = {
  minute?: number | { each: number };
  hour?: number | { each: number };
  day?: number | { each: number };
  month?: number | { each: number };
  weekDay?: number | { each: number };
};

export type JobAction =
  | {
      action: "backup";
      options: BackupCommandOptions;
    }
  | {
      action: "copy";
      options: CopyCommandOptions;
    }
  | {
      action: "prune";
      options: Omit<PruneCommandOptions, "confirm">;
    };

export type JobSchedule = string | JobScheduleObject;
export type Job = JobAction & {
  schedule?: JobSchedule;
};

export type JobConfig = {
  log: boolean;
  logPath: string | boolean | undefined;
  verbose: boolean;
  configPath: string;
};

export async function runJob(job: Job, name: string, config: JobConfig) {
  let pid = 0;
  try {
    const Command = datatruckCommandMap[job.action];
    const command = new Command(
      { config: { packages: [], repositories: [] } },
      {} as any,
    );
    const cliOptions = stringifyOptions(
      command.optionsConfig() as any,
      job.action === "prune"
        ? ({ ...job.options, confirm: true } satisfies PruneCommandOptions)
        : job.options,
    );
    const [node, bin] = process.argv;

    const baseLogPath =
      typeof config.logPath === "string"
        ? config.logPath
        : config.logPath === true || config.logPath === undefined
          ? defaultsLogPath
          : config.logPath;

    let stream: WriteStream | undefined;
    let logPath: string | undefined;
    const dt = new Date().toISOString().replaceAll(":", "-");

    if (baseLogPath) {
      const tmpLogPath = join(baseLogPath, dt) + ".log";
      await mkdir(baseLogPath, { recursive: true });
      stream = createWriteStream(tmpLogPath);
    }
    const p = new AsyncProcess(
      node,
      [
        process.env.pm_exec_path ?? bin,
        "--tty",
        "false",
        "--progress",
        "interval:3000",
        "-c",
        config.configPath,
        job.action,
        ...cliOptions,
      ],
      {
        $log: config.verbose,
        $exitCode: false,
        env: {
          ...process.env,
          COLUMNS: "160",
          NO_COLOR: "1",
        },
      },
    );

    pid = p.child.pid || 0;

    if (config.log) logJson("job", `'${name}' started`, { pid });

    const [exitCode] = await Promise.all([
      p.waitForClose(),
      stream && p.stderr.pipe(stream),
      stream && p.stdout.pipe(stream),
    ]);

    if (stream)
      await safeRename(
        stream.path.toString(),
        (logPath = join(stream.path.toString(), `${dt}-${pid}.log`)),
      );

    if (config.log)
      logJson("job", `'${name}' finished`, {
        pid,
        exitCode,
        ...(logPath && { log: logPath }),
      });
  } catch (error) {
    if (config.log) logJson("job", `'${name}' failed`, { pid });
    console.error(error);
  }
}
