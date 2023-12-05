import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { ScriptTaskDefinitionEnum } from "../Task/ScriptTask";
import { Step } from "../utils/steps";
import { PackageRepositoryConfig } from "./PackageRepositoryConfig";
import { PrunePolicyConfig } from "./PrunePolicyConfig";
import type { TaskConfig } from "./TaskConfig";
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
    meta: { type: "object" },
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

export type Meta = Record<string, any>;

export type PackageConfig = {
  name: string;
  enabled?: boolean;
  task?: TaskConfig;
  path?: string;
  restorePath?: string;
  meta?: Meta;
  restorePermissions?: {
    uid: string | number;
    gid: string | number;
  };
  include?: (string | Step)[];
  exclude?: (string | Step)[];
  repositoryNames?: string[];
  prunePolicy?: PrunePolicyConfig;
  repositoryConfigs?: PackageRepositoryConfig[];
};
