import { BackupCommandOptions } from "../../commands/BackupCommand";
import { CopyCommandOptions } from "../../commands/CopyCommand";
import { PruneCommandOptions } from "../../commands/PruneCommand";
import { AsyncProcess } from "../async-process";
import { logJson, stringifyOptions } from "../cli";
import { datatruckCommandMap } from "./command";

export type JobScheduleObject = {
  minute?: number | { each: number };
  hour?: number | { each: number };
  day?: number | { each: number };
  month?: number | { each: number };
  weekDay?: number | { each: number };
};

export type Job = {
  schedule?: string | JobScheduleObject;
} & (
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
    }
);

export async function runJob(
  job: Job,
  name: string,
  config: {
    log: boolean;
    verbose: boolean;
    configPath: string;
  },
) {
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
    const p = new AsyncProcess(
      node,
      [
        process.env.pm_exec_path ?? bin,
        "-c",
        config.configPath,
        job.action,
        ...cliOptions,
      ],
      { $log: config.verbose, $exitCode: false },
    );
    pid = p.child.pid || 0;

    if (config.log) logJson("job", `'${name}' started`, { pid });
    const exitCode = await p.waitForClose();
    if (config.log) logJson("job", `'${name}' finished`, { pid, exitCode });
  } catch (error) {
    if (config.log) logJson("job", `'${name}' failed`, { pid });
    console.error(error);
  }
}
