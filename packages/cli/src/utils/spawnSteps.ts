import { AsyncProcess } from "./async-process";
import { ProcessEnv } from "./process";
import { render } from "./string";
import { mkTmpDir } from "./temp";
import { writeFile } from "fs/promises";
import { join } from "path";

export type SpawnData = {
  [name: string]: any;
};
export type CommonSpawnStepConfig = {
  env?: ProcessEnv;
  data?: SpawnData;
  args?: (string | number)[];
};

export type ProcessStepConfig = CommonSpawnStepConfig & {
  command: string;
};

export type NodeStepConfig = CommonSpawnStepConfig & {
  code: string | string[];
};

export type ProcessStepConfigItem = {
  type: "process";
  config: ProcessStepConfig;
};

export type NodeStepConfigItem = {
  type: "node";
  config: NodeStepConfig;
};

export type SpawnStep = ProcessStepConfigItem | NodeStepConfigItem;

export type SpawnStepOptions<TData extends Record<string, any>> = {
  env?: ProcessEnv;
  data?: TData;
  cwd?: string;
  tempDir?: () => Promise<string>;
  onLine?: (p: string) => any;
  verbose?: boolean;
};

async function writeNodeScript(options: {
  code: string | string[];
  data?: Record<string, any>;
  tempDir?: () => Promise<string>;
}) {
  let tempDir: string;
  if (options?.tempDir) {
    tempDir = await options.tempDir();
  } else {
    tempDir = await mkTmpDir("node-step");
  }
  const scriptPath = join(tempDir, "script.js");
  const data = options.data || {};
  const keys = Object.keys(data);
  const json = JSON.stringify(data);
  const code = Array.isArray(options.code)
    ? [...options.code].join(";\n")
    : options.code;

  await writeFile(
    scriptPath,
    `(async function({ ${keys} }) {\n${code};\n})(${json});`,
  );
  return scriptPath;
}

export function isSpawnStep(step: {
  type: string;
}): step is Pick<SpawnStep, "type"> {
  return step.type === "process" || step.type === "node";
}

export async function runSpawnSteps<TData extends Record<string, any>>(
  input: SpawnStep[] | SpawnStep,
  options: SpawnStepOptions<TData>,
) {
  const steps = Array.isArray(input) ? input : [input];

  for (const step of steps) {
    if (step.type === "process" || step.type === "node") {
      const command = step.type === "process" ? step.config.command : "node";
      const data = {
        ...step.config.data,
        ...options.data,
      };
      const args = [
        ...(step.type === "node"
          ? [
              await writeNodeScript({
                code: step.config.code,
                tempDir: options.tempDir,
                data,
              }),
            ]
          : []),
        ...(step.config.args || []).map((arg) => render(arg.toString(), data)),
      ];
      const p = new AsyncProcess(command, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
          ...step.config.env,
        },
        $log: options.verbose,
      });
      if (options.onLine) {
        await p.stdout.parseLines(options.onLine);
      } else {
        await p.waitForClose();
      }
    } else {
      throw new Error(`Invalid step type: ${(step as any).type}`);
    }
  }
}
