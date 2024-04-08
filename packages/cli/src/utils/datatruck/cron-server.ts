import { ConfigAction } from "../../actions/ConfigAction";
import { logJson } from "../cli";
import { formatCronScheduleObject } from "../cron";
import { MaxAge, defaultsLogPath, removeOldLogs } from "../logs";
import { compareJsons } from "../string";
import { createWatcher } from "../watcher";
import { Config } from "./config-type";
import { Job, JobConfig, runJob } from "./job";
import { Cron } from "croner";

export type DatatruckCronServerOptions = {
  /**
   * @default true
   */
  enabled?: boolean;
  log?: {
    /**
     * @default true
     */
    enabled?: boolean;
    /**
     * @default '/var/logs/datatruck'
     */
    path?: string;
    rotate?: {
      /**
       * @default {"days":14}
       */
      maxAge?: MaxAge;
    };
  };
};

function createCrons(jobs: Record<string, Job>, options: JobConfig) {
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

export async function createCronServer(options: JobConfig) {
  const config = await ConfigAction.fromGlobalOptions({
    config: options.configPath,
  });

  let crons = createCrons(config.jobs || {}, options);
  let log = config.server?.cron?.log;
  const getLogPath = () => log?.path ?? defaultsLogPath;
  let reloading = false;

  const watcher = createWatcher<Config>({
    onRead: () => ConfigAction.findAndParseFile(options.configPath),
    onCheck: (prev, current) => compareJsons(prev, current),
    onError: (error) => {
      logJson("cron-server", "job update error");
      console.error(error);
    },
    onChange: (data) => {
      logJson("cron-server", "jobs updated");
      try {
        reloading = true;
        handler.stop();
        const enabled = data?.server?.cron?.enabled ?? true;
        crons = enabled ? createCrons(data?.jobs || {}, options) : [];
        log = data?.server?.cron?.log;
        handler.start();
      } finally {
        reloading = false;
      }
    },
  });

  let rotateLogsInterval: ReturnType<typeof setInterval> | undefined;
  const rotateLogs = async () => {
    const removed = await removeOldLogs(
      getLogPath(),
      log?.rotate?.maxAge ?? { days: 14 },
    );
    if (removed.length)
      logJson("cron-server", "old logs removed", {
        amount: removed.length,
      });
  };
  const handler = {
    start: () => {
      if (!reloading) {
        logJson("cron-server", `server started`, {
          "log.path": getLogPath(),
        });
        clearInterval(rotateLogsInterval);
        rotateLogsInterval = setInterval(rotateLogs, 60_000);
      }
      for (const cron of crons) cron.resume();
      watcher.start();
    },
    stop: () => {
      if (!reloading) clearInterval(rotateLogsInterval);
      watcher.stop();
      for (const cron of crons) cron.stop();
    },
  };

  return handler;
}
