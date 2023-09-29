import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { mkdirIfNotExists } from "../utils/fs";
import { Step, runSteps } from "../utils/steps";
import {
  BackupDataType,
  BeforeBackupDataType,
  BeforeRestoreDataType,
  RestoreDataType,
  TaskAbstract,
} from "./TaskAbstract";
import { ok } from "assert";
import { JSONSchema7 } from "json-schema";

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
                  stepTypes[name as keyof typeof stepTypes],
                ),
              },
            },
            else: false,
          }) as JSONSchema7,
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
        vars: {
          type: "object",
          patternProperties: { ".+": {} },
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
  override async onBeforeBackup(data: BeforeBackupDataType) {
    return {
      targetPath:
        data.package.path ?? (await this.mkTmpDir(`script-task_backup_target`)),
    };
  }

  protected getVars(data: BackupDataType | RestoreDataType) {
    return {
      process: {
        DTT_SNAPSHOT_ID: data.snapshot.id,
        DTT_SNAPSHOT_DATE: data.snapshot.date,
        DTT_PACKAGE_NAME: data.package.name,
        DTT_PACKAGE_PATH: data.package.path,
        DTT_TARGET_PATH: data.targetPath,
      },
      node: {
        dtt: {
          snapshot: data.snapshot,
          package: data.package,
          targetPath: data.targetPath,
        },
      },
    };
  }

  override async onBackup(data: BackupDataType) {
    const config = this.config;
    const targetPath = data.targetPath;
    ok(typeof targetPath === "string");
    const vars = this.getVars(data);
    await mkdirIfNotExists(targetPath);
    await runSteps(config.backupSteps, {
      env: config.env,
      verbose: data.options.verbose,
      process: { vars: vars.process },
      node: {
        tempDir: () => this.mkTmpDir("script-task_backup_node-step"),
        vars: vars.node,
      },
    });
  }

  override async onBeforeRestore(data: BeforeRestoreDataType) {
    return {
      targetPath:
        data.package.restorePath ??
        (await this.mkTmpDir(`script-task_restore_target`)),
    };
  }

  override async onRestore(data: RestoreDataType) {
    const config = this.config;
    const targetPath = data.targetPath;

    ok(typeof targetPath === "string");

    await mkdirIfNotExists(targetPath);

    const vars = this.getVars(data);

    await runSteps(config.restoreSteps, {
      env: config.env,
      verbose: data.options.verbose,
      process: { vars: vars.process },
      node: {
        tempDir: () => this.mkTmpDir("script-task_restore_node-step"),
        vars: vars.node,
      },
    });
  }
}
