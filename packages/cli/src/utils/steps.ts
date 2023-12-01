import { post } from "./http";
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

export type TelegramMessageStepConfig = {
  bot: string;
  chatId: number;
  text?: string;
};

export type Step =
  | {
      type: "process";
      config: ProcessStepConfig;
    }
  | {
      type: "node";
      config: NodeStepConfig;
    }
  | {
      type: "telegram-message";
      config: TelegramMessageStepConfig;
    };

export type StepOptions = {
  env?: Record<string, string | undefined>;
  vars?: Record<string, any>;
  cwd?: string;
  tempDir?: () => Promise<string>;
  onLine?: (p: string) => any;
  verbose?: boolean;
};

export async function runSteps(input: Step[] | Step, options: StepOptions) {
  const steps = Array.isArray(input) ? input : [input];
  for (const step of steps) {
    if (step.type === "process") {
      await exec(
        step.config.command,
        (step.config.args || []).map((v) => render(v, options?.vars || {})),
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
      if (options?.tempDir) {
        tempDir = await options.tempDir();
      } else {
        tempDir = await mkTmpDir("node-step");
      }
      const scriptPath = join(tempDir, "script.js");
      const vars = {
        ...step.config.vars,
        ...options?.vars,
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
    } else if (step.type === "telegram-message") {
      await post(
        `https://api.telegram.org/bot${step.config.bot}/sendMessage`,
        JSON.stringify({
          chat_id: step.config.chatId.toString(),
          text: render(step.config.text ?? `{dtt.text}`, options?.vars || {}),
          disable_notification: true,
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    } else {
      throw new Error(`Invalid step type: ${(step as any).type}`);
    }
  }
}
