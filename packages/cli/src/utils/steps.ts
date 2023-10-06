import { exec } from "./process";
import { render } from "./string";
import { mkTmpDir } from "./temp";
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
  cwd?: string;
  onLine?: (p: string) => any;
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
          cwd: options.cwd,
          env: {
            ...process.env,
            ...options.env,
            ...step.config.env,
          },
        },
        {
          log: options.verbose,
          ...(options.onLine && {
            stdout: {
              parseLines: "skip-empty",
              onData: (line) => options.onLine!(line),
            },
          }),
        },
      );
    } else if (step.type === "node") {
      let tempDir: string;
      if (options.node?.tempDir) {
        tempDir = await options.node.tempDir();
      } else {
        tempDir = await mkTmpDir("node-step");
      }
      const scriptPath = join(tempDir, "script.js");
      const vars = {
        ...step.config.vars,
        ...options.node?.vars,
      };
      const varKeys = Object.keys(vars);
      const varJson = JSON.stringify(vars);
      const code = Array.isArray(step.config.code)
        ? [...step.config.code].join(";\n")
        : step.config.code;

      await writeFile(
        scriptPath,
        `(async function({ ${varKeys} }) {\n${code};\n})(${varJson});`,
      );
      await exec(
        "node",
        [scriptPath],
        {
          cwd: options.cwd,
          env: {
            ...process.env,
            ...options.env,
            ...step.config.env,
          },
        },
        {
          log: options.verbose,
          ...(options.onLine && {
            stdout: {
              parseLines: "skip-empty",
              onData: (line) => options.onLine!(line),
            },
          }),
        },
      );
    } else {
      throw new Error(`Invalid step type: ${(step as any).type}`);
    }
  }
}
