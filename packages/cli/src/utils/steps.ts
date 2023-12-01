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

export type NtfyStepConfig = {
  token: string;
  topic?: string;
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
    }
  | {
      type: "ntfy";
      config: NtfyStepConfig;
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
  const vars = options?.vars || {};
  for (const step of steps) {
    if (step.type === "process") {
      await exec(
        step.config.command,
        (step.config.args || []).map((v) => render(v, vars)),
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
      const nodeVars = {
        ...step.config.vars,
        ...vars,
      };
      const varKeys = Object.keys(nodeVars);
      const varJson = JSON.stringify(nodeVars);
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
          text: render(step.config.text ?? `{dtt.text}`, vars),
          disable_notification: true,
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    } else if (step.type === "ntfy") {
      const topic = [step.config.token, step.config.topic]
        .filter(Boolean)
        .join("-");
      if (topic.length < 32)
        throw new Error(`Topic is less than 32 characters: ${topic}`);
      await post(
        `https://ntfy.sh/${topic}`,
        render(step.config.text ?? `{dtt.text}`, vars),
        {
          headers: {
            Title: render("{dtt.title}", vars),
            Priority: vars.success ? "default" : "high",
          },
        },
      );
    } else {
      throw new Error(`Invalid step type: ${(step as any).type}`);
    }
  }
}
