import { createJobRunners } from "../utils/job.js";
import { Action } from "./base.js";

export type RunOptions = {
  jobNames: string[];
};

export class Run extends Action {
  async run(options: RunOptions) {
    if (!options.jobNames.length)
      throw new Error("At least one job name must be specified");
    for (const runners of createJobRunners(options.jobNames, this.config)) {
      for (const runner of runners) {
        try {
          await runner.run();
        } catch (error) {
          console.error(`Error running job ${runner.name}:`, error);
        }
      }
    }
  }
}
