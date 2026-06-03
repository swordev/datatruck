import { Config, parseConfigFile } from "../config.js";
import { resolveCronSchedule } from "../utils/cron.js";
import { createJobRunners } from "../utils/job.js";
import { Ntfy } from "../utils/ntfy.js";
import { parseCronExpression } from "cron-schedule";

export type StartCronOptions = {};

export class StartCron {
  protected ntfy: Ntfy;
  constructor(
    config: Config,
    readonly globalOptions: {
      config: string;
      verbose?: boolean;
    },
  ) {
    this.ntfy = new Ntfy({
      token: config.ntfyToken,
      titlePrefix: config.hostname,
    });
  }

  private startInterval(options: StartCronOptions, cb: () => any) {
    const delay = this.getDelayUntilNextMinute(new Date());
    if (this.globalOptions.verbose) console.info(`Waiting ${delay}`);
    return setTimeout(async () => {
      await cb();
      this.startInterval(options, cb);
    }, delay);
  }

  private getDelayUntilNextMinute(date: Date, offset = 60_000) {
    const elapsedMs = date.getSeconds() * 1000 + date.getMilliseconds();
    return elapsedMs === 0 ? offset : offset - elapsedMs;
  }

  private createJobs(config: Config) {
    return Object.entries(config.jobs || {})
      .map(([name, job]) => {
        if (!job.schedule) return;
        const schedule = resolveCronSchedule(job.schedule);
        const cron = parseCronExpression(schedule);
        return { name, cron };
      })
      .filter((v) => v !== undefined);
  }

  private getTickDate(date: Date) {
    const tickDate = new Date(date);
    tickDate.setSeconds(0, 0);
    return tickDate;
  }

  protected async nextRun() {
    const date = this.getTickDate(new Date());
    const config = await parseConfigFile(this.globalOptions.config);
    const jobNames = this.createJobs(config)
      .filter((job) => job.cron.matchDate(date))
      .map((job) => job.name);
    for (const runners of createJobRunners(jobNames, config)) {
      for (const runner of runners) {
        try {
          await this.ntfy.send("Running job", { name: runner.name });
          await runner.run();
        } catch (error) {
          await this.ntfy.send("Error running job", {
            name: runner.name,
            error: (error as any)?.message,
          });
        }
      }
    }
  }

  async run(options: StartCronOptions) {
    await this.ntfy.send("Cron started");
    this.startInterval(options, () => this.nextRun());
  }
}
