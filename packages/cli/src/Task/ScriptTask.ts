import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { ensureEmptyDir, mkdirIfNotExists, mkTmpDir } from "../util/fs-util";
import { exec } from "../util/process-util";
import { render } from "../util/string-util";
import { BackupDataType, RestoreDataType, TaskAbstract } from "./TaskAbstract";
import { ok } from "assert";
import { writeFile } from "fs/promises";
import { JSONSchema7 } from "json-schema";
import { join } from "path";

export type ProcessStepConfig = {
  command: string;
  env?: Record<string, string>;
  args?: string[];
};

export type NodeStepConfig = {
  env?: Record<string, string>;
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

export type ScriptTaskConfigType = {
  env?: Record<string, string | undefined>;
  backupSteps: Step[];
  restoreSteps: Step[];
};

enum ScriptTaskDefinitionEnum {
  step = "step",
  processStepConfig = "processStepConfig",
  nodeStepConfig = "nodeStepConfig",
}

const stepTypes = {
  process: ScriptTaskDefinitionEnum.processStepConfig,
  node: ScriptTaskDefinitionEnum.nodeStepConfig,
};

export const scriptTaskName = "script";

export const scriptTaskDefinition: JSONSchema7 = {
  definitions: {
    step: {
      type: "object",
      required: ["type"],
      properties: {
        type: { enum: Object.keys(stepTypes) },
        config: {},
      },
      anyOf: Object.keys(stepTypes).map(
        (name) =>
          ({
            if: {
              type: "object",
              properties: {
                type: { const: name },
              },
            },
            then: {
              type: "object",
              properties: {
                config: makeRef(
                  DefinitionEnum.scriptTask,
                  stepTypes[name as keyof typeof stepTypes]
                ),
              },
            },
            else: false,
          } as JSONSchema7)
      ),
    },
    processStepConfig: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" },
        env: {
          type: "object",
          patternProperties: { ".+": { type: "string" } },
        },
        args: makeRef(DefinitionEnum.stringListUtil),
      },
    },
    nodeStepConfig: {
      type: "object",
      required: ["code"],
      properties: {
        code: {
          anyOf: [{ type: "string" }, makeRef(DefinitionEnum.stringListUtil)],
        },
        env: {
          type: "object",
          patternProperties: { ".+": { type: "string" } },
        },
      },
    },
  },
  type: "object",
  additionalProperties: false,
  required: ["backupSteps", "restoreSteps"],
  properties: {
    env: {
      type: "object",
      patternProperties: {
        ".+": { type: "string" },
      },
    },
    backupSteps: {
      type: "array",
      items: makeRef(DefinitionEnum.scriptTask, ScriptTaskDefinitionEnum.step),
    },
    restoreSteps: {
      type: "array",
      items: makeRef(DefinitionEnum.scriptTask, ScriptTaskDefinitionEnum.step),
    },
  },
};

export class ScriptTask extends TaskAbstract<ScriptTaskConfigType> {
  protected verbose?: boolean;
  override async onBeforeBackup() {
    return {
      targetPath: await mkTmpDir(ScriptTask.name),
    };
  }

  protected getVars(
    data: BackupDataType | RestoreDataType
  ): Record<string, string | undefined> {
    return {
      DTT_SNAPSHOT_ID: data.snapshot.id,
      DTT_SNAPSHOT_DATE: data.snapshot.date,
      DTT_PACKAGE_NAME: data.package.name,
      DTT_PACKAGE_PATH: data.package.path,
      DTT_TARGET_PATH: data.targetPath,
    };
  }

  static async processSteps(
    input: Step[] | Step,
    options: {
      env?: Record<string, string | undefined>;
      vars: Record<string, string | undefined>;
      verbose?: boolean;
    }
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
          }
        );
      } else if (step.type === "node") {
        const tempDir = await mkTmpDir("script-task-node-step");
        const scriptPath = join(tempDir, "script.js");
        await writeFile(
          scriptPath,
          Array.isArray(step.config.code)
            ? step.config.code.join("\n")
            : step.config.code
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
          }
        );
      } else {
        throw new Error(`Invalid step type: ${(step as any).type}`);
      }
    }
  }

  override async onBackup(data: BackupDataType) {
    this.verbose = data.options.verbose;
    const config = this.config;

    const path = data.package.path;
    const targetPath = data.targetPath;

    ok(typeof path === "string");
    ok(typeof targetPath === "string");

    await ScriptTask.processSteps(config.backupSteps, {
      env: config.env,
      vars: this.getVars(data),
      verbose: this.verbose,
    });
  }

  override async onBeforeRestore() {
    return {
      targetPath: await mkTmpDir(ScriptTask.name),
    };
  }

  override async onRestore(data: RestoreDataType) {
    this.verbose = data.options.verbose;
    const config = this.config;

    const restorePath = data.package.restorePath;
    const targetPath = data.targetPath;

    ok(typeof restorePath === "string");
    ok(typeof targetPath === "string");

    await mkdirIfNotExists(restorePath);
    await ensureEmptyDir(restorePath);

    await ScriptTask.processSteps(config.restoreSteps, {
      env: config.env,
      vars: this.getVars(data),
      verbose: this.verbose,
    });
  }
}
