import { ConfigAction } from "../actions/ConfigAction";
import { runJob } from "../utils/datatruck/job";
import { AppError } from "../utils/error";
import { InferOptions, defineOptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const runCommandOptions = defineOptionsConfig({
  jobName: {
    description: "Job name",
    required: true,
  },
});

export type RunCommandOptions = InferOptions<typeof runCommandOptions>;

export class RunCommand extends CommandAbstract<typeof runCommandOptions> {
  static override config() {
    return {
      name: "run",
      options: runCommandOptions,
    };
  }
  override get optionsConfig() {
    return runCommandOptions;
  }
  override async exec() {
    const config = await ConfigAction.fromGlobalOptionsWithPath(
      this.globalOptions,
    );
    const verbose = !!this.globalOptions.verbose;
    const log = config.data.server?.log ?? true;
    const jobs = config.data.jobs || {};
    const jobName = this.options.jobName;
    const job = jobs[jobName];

    if (!job) throw new AppError(`Job not found: ${jobName}`);

    await runJob(job, jobName, {
      log,
      verbose: verbose,
      configPath: config.path!,
      logPath: config.data.server?.cron?.logPath,
    });

    return { exitCode: 0 };
  }
}
