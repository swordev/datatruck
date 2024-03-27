import { ConfigAction } from "../actions/ConfigAction";
import { runJob } from "../utils/datatruck/job";
import { InferOptions, OptionsConfig } from "../utils/options";
import { CommandAbstract } from "./CommandAbstract";

export const runCommandOptions = {
  jobName: {
    description: "Job name",
    flag: false,
  },
} satisfies OptionsConfig;

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
    const job = jobName ? jobs[jobName] : undefined;

    if (!job || !jobName) {
      const jobNames = Object.keys(config.data.jobs || {});
      console.error(
        `error: missing required argument 'jobName' (values: ${jobNames.join(", ")})`,
      );
      return { exitCode: 1 };
    }

    await runJob(job, jobName, {
      log,
      verbose: verbose,
      configPath: config.path!,
      logPath: config.data.server?.cron?.logPath,
    });

    return { exitCode: 0 };
  }
}
