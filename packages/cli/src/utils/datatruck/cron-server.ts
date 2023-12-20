import { ConfigAction } from "../../actions/ConfigAction";
import { BackupCommandOptions } from "../../commands/BackupCommand";
import { CopyCommandOptions } from "../../commands/CopyCommand";
import { PruneCommandOptions } from "../../commands/PruneCommand";
import { stringifyOptions } from "../cli";
import { formatCronScheduleObject } from "../cron";
import { exec } from "../process";
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
      options: PruneCommandOptions;
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
    if (config.log) console.info(`> [job] ${index} - ${action.name}`);
    try {
      const Command = datatruckCommandMap[action.name];
      const command = new Command(
        { config: { packages: [], repositories: [] } },
        {} as any,
      );
      const cliOptions = stringifyOptions(
        command.optionsConfig() as any,
        action.options,
      );
      const [node, bin] = process.argv;
      await exec(
        node,
        [bin, "-c", config.configPath, action.name, ...cliOptions],
        {},
        { log: config.verbose },
      );
      if (config.log) console.info(`< [job] ${index} - ${action.name}`);
    } catch (error) {
      if (config.log) console.error(`< [job] ${index} - ${action.name}`, error);
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
      if (config.log) console.error(`< [jobs] update error`, error);
    },
    onChange: (data) => {
      if (config.log) console.info(`[jobs] updated`);
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
