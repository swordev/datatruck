import { PackageConfigType } from "../Config/PackageConfig";
import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { PreSnapshot } from "../Repository/RepositoryAbstract";
import { Step, runSteps } from "../utils/steps";
import { mkTmpDir } from "../utils/temp";
import {
  TaskBackupData,
  TaskPrepareRestoreData,
  TaskRestoreData,
  TaskAbstract,
} from "./TaskAbstract";
import { JSONSchema7 } from "json-schema";

type NodeVars = {
  dtt: {
    snapshot: PreSnapshot;
    package: PackageConfigType;
    snapshotPath: string;
  };
};

export type ScriptTaskConfigType = {
  env?: Record<string, string | undefined>;
  backupSteps: Step[];
  restoreSteps: Step[];
};

export function scriptTaskCode<V extends Record<string, any>>(
  cb: (vars: NodeVars & V) => void,
) {
  return `(${cb.toString()})(...arguments);`;
}

export enum ScriptTaskDefinitionEnum {
  step = "step",
  processStepConfig = "processStepConfig",
  nodeStepConfig = "nodeStepConfig",
  telegramMessageStepConfig = "telegramMessageStepConfig",
}

const stepTypes = {
  process: ScriptTaskDefinitionEnum.processStepConfig,
  node: ScriptTaskDefinitionEnum.nodeStepConfig,
  "telegram-message": ScriptTaskDefinitionEnum.telegramMessageStepConfig,
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
    telegramMessageStepConfig: {
      type: "object",
      required: ["bot", "chatId"],
      properties: {
        command: { type: "string" },
        chatId: { type: "integer" },
        text: { type: "string" },
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

  protected getVars(data: TaskBackupData | TaskRestoreData) {
    return {
      process: {
        DTT_SNAPSHOT_ID: data.snapshot.id,
        DTT_SNAPSHOT_DATE: data.snapshot.date,
        DTT_PACKAGE_NAME: data.package.name,
        DTT_PACKAGE_PATH: data.package.path,
        DTT_SNAPSHOT_PATH: data.snapshotPath,
      },
      node: {
        dtt: {
          snapshot: data.snapshot,
          package: data.package,
          snapshotPath: data.snapshotPath,
        },
      } as NodeVars,
    };
  }
  override async backup(data: TaskBackupData) {
    const config = this.config;
    const snapshotPath =
      data.package.path ??
      (await mkTmpDir(scriptTaskName, "task", "backup", "snapshot"));
    const vars = this.getVars({
      ...data,
      snapshotPath,
    });
    await runSteps(config.backupSteps, {
      env: config.env,
      cwd: snapshotPath,
      verbose: data.options.verbose,
      process: { vars: vars.process },
      node: {
        tempDir: () => mkTmpDir(scriptTaskName, "task", "backup", "nodeStep"),
        vars: vars.node,
      },
    });

    return { snapshotPath };
  }

  override async prepareRestore(data: TaskPrepareRestoreData) {
    return {
      snapshotPath:
        data.package.restorePath ??
        (await mkTmpDir(scriptTaskName, "task", "restore", "snapshot")),
    };
  }

  override async restore(data: TaskRestoreData) {
    const config = this.config;
    const vars = this.getVars(data);
    await runSteps(config.restoreSteps, {
      env: config.env,
      verbose: data.options.verbose,
      process: { vars: vars.process },
      node: {
        tempDir: () => mkTmpDir(scriptTaskName, "task", "restore", "nodeStep"),
        vars: vars.node,
      },
    });
  }
}
