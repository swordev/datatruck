import { BackupCommandOptions } from "../../commands/BackupCommand";
import { CopyCommandOptions } from "../../commands/CopyCommand";
import { PruneCommandOptions } from "../../commands/PruneCommand";
import { AsyncProcess } from "../async-process";
import { logJson } from "../cli";
import { safeRename } from "../fs";
import { defaultsLogPath } from "../logs";
import { stringifyOptions } from "../options";
import { datatruckCommands } from "./command";
import { DatatruckCronServerOptions } from "./cron-server";
import { createWriteStream } from "fs";
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
  log: DatatruckCronServerOptions["log"];
  verbose: boolean;
  configPath: string;
};

async function createJobLog(
  config: DatatruckCronServerOptions["log"],
  name: string,
) {
  const dt = new Date().toISOString().replaceAll(":", "-");
  const dir = config?.path ?? defaultsLogPath;
  const tmpPath = join(dir, `${dt}_${name}.tmp.log`);
  await mkdir(dir, { recursive: true });
  const stream = createWriteStream(tmpPath);
  return {
    stream,
    write(data: string) {
      stream.write(data);
    },
    async finish(pid: number) {
      const path = join(dir, `${dt}_${name}_${pid}.log`);
      await safeRename(tmpPath, path);
      return path;
    },
  };
}

export function getJobCliOptions(job: Job) {
  const Command = datatruckCommands[job.action];
  const command = new Command(
    { config: { packages: [], repositories: [] } },
    {} as any,
  );
  return stringifyOptions(
    command.optionsConfig,
    job.action === "prune"
      ? ({ ...job.options, confirm: true } satisfies PruneCommandOptions)
      : job.options,
  );
}

export async function runJob(
  job: Job,
  name: string,
  config: Omit<JobConfig, "log">,
) {
  const cliOptions = getJobCliOptions(job);
  const [node, bin] = process.argv;

  return await AsyncProcess.exec(
    node,
    [
      process.env.DTT_BIN_SCRIPT ?? process.env.pm_exec_path ?? bin,
      "-c",
      config.configPath,
      job.action,
      ...cliOptions,
      ...(config.verbose ? ["-v"] : []),
    ],
    {
      $exitCode: false,
      $log: { exec: config.verbose },
      env: {
        ...process.env,
        JOB_NAME: name,
      },
      stdio: "inherit",
    },
  );
}

export async function runCronJob(job: Job, name: string, config: JobConfig) {
  let pid = 0;

  try {
    const log =
      config.log?.enabled ?? true
        ? await createJobLog(config.log, name)
        : undefined;
    const cliOptions = getJobCliOptions(job);
    const [node, bin] = process.argv;

    const argv = [
      process.env.DTT_BIN_SCRIPT ?? process.env.pm_exec_path ?? bin,
      "--tty",
      "false",
      "--progress",
      "interval:3000",
      "-c",
      config.configPath,
      job.action,
      ...cliOptions,
    ];

    log?.write(`+ dtt ${argv.slice(1).join(" ")}\n`);

    const p = new AsyncProcess(node, argv, {
      $log: config.verbose,
      $exitCode: false,
      env: {
        ...process.env,
        JOB_NAME: name,
        COLUMNS: "160",
        NO_COLOR: "1",
      },
    });

    pid = p.child.pid || 0;

    logJson("job", `'${name}' started`, { pid });

    const [exitCode] = await Promise.all([
      p.waitForClose(),
      log && p.stderr.pipe(log.stream),
      log && p.stdout.pipe(log.stream),
    ]);

    const logPath = await log?.finish(pid);

    logJson("job", `'${name}' finished`, {
      pid,
      exitCode,
      ...(logPath && { log: logPath }),
    });
  } catch (error) {
    logJson("job", `'${name}' failed`, { pid });
    console.error(error);
  }
}
