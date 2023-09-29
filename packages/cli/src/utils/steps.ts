import { exec } from "./process";
import { render } from "./string";
import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export type StepEnv = Record<string, string>;

export type ProcessStepConfig = {
  command: string;
  env?: StepEnv;
  args?: string[];
};

export type NodeStepConfig = {
  env?: StepEnv;
  vars?: Record<string, any>;
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
  process?: {
    vars?: Record<string, string | undefined>;
  };
  node?: {
    vars?: Record<string, any>;
    tempDir?: () => Promise<string>;
  };
  verbose?: boolean;
};

export async function runSteps(input: Step[] | Step, options: StepOptions) {
  const steps = Array.isArray(input) ? input : [input];
  for (const step of steps) {
    if (step.type === "process") {
      await exec(
        step.config.command,
        (step.config.args || []).map((v) =>
          render(v, options.process?.vars || {}),
        ),
        {
          env: {
            ...process.env,
            ...options.env,
            ...step.config.env,
          },
        },
        {
          log: options.verbose,
        },
      );
    } else if (step.type === "node") {
      let tempDir: string;
      if (options.node?.tempDir) {
        tempDir = await options.node.tempDir();
      } else {
        tempDir = join(tmpdir(), randomBytes(8).toString("hex"));
        await mkdir(tempDir, { recursive: true });
      }
      const scriptPath = join(tempDir, "script.js");

      const vars = Object.entries({
        ...step.config.vars,
        ...options.node?.vars,
      }).reduce((items, [name, value]) => {
        items.push(`let ${name} = ${JSON.stringify(value)}`);
        return items;
      }, [] as string[]);

      await writeFile(
        scriptPath,
        Array.isArray(step.config.code)
          ? [...vars, ...step.config.code].join(";\n")
          : `${vars.join(";\n")}\n${step.config.code}`,
      );
      await exec(
        "node",
        [scriptPath],
        {
          env: {
            ...process.env,
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
