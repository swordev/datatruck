import { exec } from "./process";
import { render } from "./string";
import { writeFile } from "fs/promises";
import { join } from "path";

export type StepEnv = Record<string, string>;

export type ProcessStepConfig = {
  command: string;
  env?: StepEnv;
  args?: string[];
};

export type NodeStepConfig = {
  env?: StepEnv;
  code: string | string[];
};

export type Step =
  | {
      type: "process";
      config: ProcessStepConfig;
    }
  | {
      type: "node";
      config: NodeStepConfig;
    };

export type StepOptions = {
  env?: Record<string, string | undefined>;
  vars: Record<string, string | undefined>;
  verbose?: boolean;
};

export async function runSteps(
  input: Step[] | Step,
  options: StepOptions,
  createTempDir: (name: string) => Promise<string>,
) {
  const steps = Array.isArray(input) ? input : [input];
  for (const step of steps) {
    if (step.type === "process") {
      await exec(
        step.config.command,
        (step.config.args || []).map((v) => render(v, options.vars)),
        {
          env: {
            ...process.env,
            ...options.vars,
            ...options.env,
            ...step.config.env,
          },
        },
        {
          log: options.verbose,
        },
      );
    } else if (step.type === "node") {
      const tempDir = await createTempDir("script-task-node-step");
      const scriptPath = join(tempDir, "script.js");
      await writeFile(
        scriptPath,
        Array.isArray(step.config.code)
          ? step.config.code.join("\n")
          : step.config.code,
      );
      await exec(
        "node",
        [scriptPath],
        {
          env: {
            ...process.env,
            ...options.vars,
            ...options.env,
            ...step.config.env,
          },
        },
        {
          log: options.verbose,
        },
      );
    } else {
      throw new Error(`Invalid step type: ${(step as any).type}`);
    }
  }
}
