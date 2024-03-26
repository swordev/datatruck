import { ConfigAction } from "../actions/ConfigAction";
import { runJob } from "../utils/datatruck/job";
import { AppError } from "../utils/error";
import { CommandAbstract } from "./CommandAbstract";

export type RunCommandOptions<TResolved = false> = {
  jobName: string;
};

export class RunCommand extends CommandAbstract<
  RunCommandOptions<false>,
  RunCommandOptions<true>
> {
  override optionsConfig() {
    return this.castOptionsConfig({
      jobName: {
        description: "Job name",
        required: true,
      },
    });
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
