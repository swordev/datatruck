import { BackupCommandOptions } from "../../Command/BackupCommand";
import { CopyCommandOptionsType } from "../../Command/CopyCommand";
import { CommandConstructorFactory } from "../../Factory/CommandFactory";
import { stringifyOptions } from "../cli";
import { exec } from "../process";
import { Cron } from "croner";

export type CronAction =
  | {
      schedule: string;
      name: "backup";
      options: BackupCommandOptions;
    }
  | {
      schedule: string;
      name: "copy";
      options: CopyCommandOptionsType;
    };

export type DatatruckCronServerOptions = {
  enabled?: boolean;
  actions?: CronAction[];
};

function createJobs(
  actions: CronAction[],
  currentJobs: Cron[] = [],
  worker: (action: CronAction, index: number) => Promise<void>,
) {
  const jobs: Cron[] = [];
  for (const action of actions) {
    const index = actions.indexOf(action);
    const context = JSON.stringify({
      index: actions.indexOf(action),
      data: action,
    });
    const job = currentJobs.at(index);
    if (!job || job.options.context !== context) {
      job?.stop();
      jobs.push(
        Cron(
          action.schedule,
          {
            paused: true,
            context: JSON.stringify(action),
            catch: true,
            protect: true,
          },
          () => worker(action, index),
        ),
      );
    }
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
      const Command = CommandConstructorFactory(action.name as any);
      const command = new Command(
        { config: { packages: [], repositories: [] } },
        {},
      );
      const cliOptions = stringifyOptions(command.onOptions(), action.options);
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

  const jobs = createJobs(options.actions || [], [], worker);

  return {
    start: () => {
      for (const job of jobs) job.resume();
    },
    stop: () => {
      for (const job of jobs) job.stop();
    },
  };
}
