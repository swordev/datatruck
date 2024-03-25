import { ConfigAction } from "../../actions/ConfigAction";
import { logJson } from "../cli";
import { formatCronScheduleObject } from "../cron";
import { compareJsons } from "../string";
import { createWatcher } from "../watcher";
import { Config } from "./config-type";
import { Job, runJob } from "./job";
import { Cron } from "croner";

export type DatatruckCronServerOptions = {
  enabled?: boolean;
};

type Options = {
  log: boolean;
  verbose: boolean;
  configPath: string;
};

function createCrons(jobs: Record<string, Job>, options: Options) {
  const crons: Cron[] = [];
  for (const name in jobs) {
    const job = jobs[name];
    if (job.schedule)
      crons.push(
        Cron(
          typeof job.schedule === "string"
            ? job.schedule
            : formatCronScheduleObject(job.schedule),
          {
            paused: true,
            context: name,
            catch: true,
            protect: true,
          },
          () => runJob(job, name, options),
        ),
      );
  }
  return crons;
}

export async function createCronServer(options: Options) {
  const config = await ConfigAction.fromGlobalOptions({
    config: options.configPath,
  });

  let crons = createCrons(config.jobs || {}, options);

  const watcher = createWatcher<Config>({
    onRead: () => ConfigAction.findAndParseFile(options.configPath),
    onCheck: (prev, current) => compareJsons(prev, current),
    onError: (error) => {
      if (options.log) {
        logJson("cron-server", "job update error");
        console.error(error);
      }
    },
    onChange: (data) => {
      if (options.log) logJson("cron-server", "jobs updated");
      handler.stop();
      const enabled = data?.server?.cron?.enabled ?? true;
      crons = enabled ? createCrons(data?.jobs || {}, options) : [];
      handler.start();
    },
  });

  const handler = {
    start: () => {
      for (const cron of crons) cron.resume();
      watcher.start();
    },
    stop: () => {
      watcher.stop();
      for (const cron of crons) cron.stop();
    },
  };

  return handler;
}
