import { ConfigAction } from "../../actions/ConfigAction";
import { BackupCommandOptions } from "../../commands/BackupCommand";
import { CopyCommandOptions } from "../../commands/CopyCommand";
import { PruneCommandOptions } from "../../commands/PruneCommand";
import { AsyncProcess } from "../async-process";
import { logJson, stringifyOptions } from "../cli";
import { formatCronScheduleObject } from "../cron";
import { compareJsons } from "../string";
import { createWatcher } from "../watcher";
import { datatruckCommandMap } from "./command";
import { Cron } from "croner";

export type CronScheduleObject = {
  minute?: number | { each: number };
  hour?: number | { each: number };
  day?: number | { each: number };
  month?: number | { each: number };
  weekDay?: number | { each: number };
};

export type CronAction = {
  schedule: string | CronScheduleObject;
} & (
  | {
      name: "backup";
      options: BackupCommandOptions;
    }
  | {
      name: "copy";
      options: CopyCommandOptions;
    }
  | {
      name: "prune";
      options: Omit<PruneCommandOptions, "confirm">;
    }
);

export type DatatruckCronServerOptions = {
  enabled?: boolean;
  actions?: CronAction[];
};

function createJobs(
  actions: CronAction[],
  worker: (action: CronAction, index: number) => Promise<void>,
) {
  const jobs: Cron[] = [];
  for (const action of actions) {
    const index = actions.indexOf(action);
    jobs.push(
      Cron(
        typeof action.schedule === "string"
          ? action.schedule
          : formatCronScheduleObject(action.schedule),
        {
          paused: true,
          context: index,
          catch: true,
          protect: true,
        },
        () => worker(action, index),
      ),
    );
  }
  return jobs;
}

export function createCronServer(
  options: DatatruckCronServerOptions,
  config: {
    log: boolean;
    verbose: boolean;
    configPath: string;
  },
) {
  const worker = async (action: CronAction, index: number) => {
    let pid = 0;
    try {
      const Command = datatruckCommandMap[action.name];
      const command = new Command(
        { config: { packages: [], repositories: [] } },
        {} as any,
      );
      const cliOptions = stringifyOptions(
        command.optionsConfig() as any,
        action.name === "prune"
          ? ({ ...action.options, confirm: true } satisfies PruneCommandOptions)
          : action.options,
      );
      const [node, bin] = process.argv;
      const p = new AsyncProcess(
        node,
        [
          process.env.pm_exec_path ?? bin,
          "-c",
          config.configPath,
          action.name,
          ...cliOptions,
        ],
        { $log: config.verbose, $exitCode: false },
      );
      pid = p.child.pid || 0;

      if (config.log) logJson("cron-server", `${action.name} started`, { pid });
      const exitCode = await p.waitForClose();
      if (config.log)
        logJson("cron-server", `${action.name} finished`, { pid, exitCode });
    } catch (error) {
      if (config.log) logJson("cron-server", `${action.name} failed`, { pid });
      console.error(error);
    }
  };

  let jobs = createJobs(options.actions || [], worker);

  const watcher = createWatcher<{
    server?: {
      cron?: typeof options;
    };
  }>({
    onRead: () => ConfigAction.findAndParseFile(config.configPath),
    onCheck: (prev, current) => compareJsons(prev, current),
    onError: (error) => {
      if (config.log) {
        logJson("cron-server", "job update error");
        console.error(error);
      }
    },
    onChange: (data) => {
      if (config.log) logJson("cron-server", "jobs updated");
      handler.stop();
      const cron = data?.server?.cron;
      const enabled = cron?.enabled ?? true;
      jobs = enabled ? createJobs(cron?.actions || [], worker) : [];
      handler.start();
    },
  });

  const handler = {
    start: () => {
      for (const job of jobs) job.resume();
      watcher.start();
    },
    stop: () => {
      watcher.stop();
      for (const job of jobs) job.stop();
    },
  };

  return handler;
}
