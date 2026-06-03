import { Backup } from "../actions/backup.js";
import { Copy } from "../actions/copy.js";
import { Exec } from "../actions/exec.js";
import { Config } from "../config.js";

export type JobRun = () => Promise<void>;
export type JobRunner = {
  name: string;
  run: JobRun;
};

export function createJobRunners(
  jobNames: string[],
  config: Config,
): JobRunner[][] {
  const groups: Record<string, JobRunner[]> = {};
  for (const name of jobNames) {
    const run = createJobRun(name, config);
    const job = config.jobs?.[name];
    const group = job?.group || "default";
    groups[group] ||= [];
    groups[group].push({ name, run });
  }
  return Object.values(groups).map((instances) => instances);
}

export function createJobRun(
  name: string,
  config: Config,
): () => Promise<void> {
  const job = config.jobs?.[name];
  if (!job) {
    throw new Error(`Job ${name} not found`);
  } else if (job.action === "copy") {
    const copy = new Copy(config);
    return () => copy.run(job.options);
  } else if (job.action === "backup") {
    const backup = new Backup(config);
    return () => backup.run(job.options);
  } else if (job.action === "exec") {
    const exec = new Exec(config);
    return () => exec.run(job.options);
  } else {
    throw new Error(`Invalid job action: ${(job as any).action}`);
  }
}
