import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
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
        anyOf: [{ type: "string" }, makeRef(DefinitionEnum.pathsObject)],
      },
    },
    exclude: {
      type: "array",
      items: {
        anyOf: [{ type: "string" }, makeRef(DefinitionEnum.pathsObject)],
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

export const pathsObjectDefinition: JSONSchema7 = {
  type: "object",
  required: ["type"],
  properties: {
    type: { type: "string" },
  },
  anyOf: [
    {
      if: {
        type: "object",
        properties: {
          type: { const: "spawn" },
        },
      },
      then: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string" },
          args: makeRef(DefinitionEnum.stringListUtil),
        },
      },
      else: false,
    },
  ],
};

export type PathsObjectType = {
  type: "spawn";
  command: string;
  args?: string[];
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
  include?: (string | PathsObjectType)[];
  exclude?: (string | PathsObjectType)[];
  repositoryNames?: string[];
  prunePolicy?: PrunePolicyConfigType;
  repositoryConfigs?: PackageRepositoryConfigType[];
};
