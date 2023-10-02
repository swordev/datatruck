import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { ScriptTaskDefinitionEnum } from "../Task/ScriptTask";
import { Step } from "../utils/steps";
import { PackageRepositoryConfigType } from "./PackageRepositoryConfig";
import { PrunePolicyConfigType } from "./PrunePolicyConfig";
import type { TaskConfigType } from "./TaskConfig";
import { JSONSchema7 } from "json-schema";

export const packageConfigDefinition: JSONSchema7 = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    enabled: { type: "boolean" },
    task: makeRef(DefinitionEnum.task),
    path: { type: "string" },
    restorePath: { type: "string" },
    restorePermissions: {
      type: "object",
      required: ["uid", "gid"],
      additionalProperties: false,
      properties: {
        uid: { anyOf: [{ type: "string" }, { type: "integer" }] },
        gid: { anyOf: [{ type: "string" }, { type: "integer" }] },
      },
    },
    include: {
      type: "array",
      items: {
        anyOf: [
          { type: "string" },
          makeRef(DefinitionEnum.scriptTask, ScriptTaskDefinitionEnum.step),
        ],
      },
    },
    exclude: {
      type: "array",
      items: {
        anyOf: [
          { type: "string" },
          makeRef(DefinitionEnum.scriptTask, ScriptTaskDefinitionEnum.step),
        ],
      },
    },
    repositoryNames: makeRef(DefinitionEnum.stringListUtil),
    repositoryConfigs: {
      type: "array",
      items: makeRef(DefinitionEnum.packageRepository),
    },
    prunePolicy: makeRef(DefinitionEnum.prunePolicy),
  },
};

export type PackageConfigType = {
  name: string;
  enabled?: boolean;
  task?: TaskConfigType;
  path?: string;
  restorePath?: string;
  restorePermissions?: {
    uid: string | number;
    gid: string | number;
  };
  include?: (string | Step)[];
  exclude?: (string | Step)[];
  repositoryNames?: string[];
  prunePolicy?: PrunePolicyConfigType;
  repositoryConfigs?: PackageRepositoryConfigType[];
};
