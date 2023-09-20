import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import {
  DatatruckRepositoryConfigType,
  datatruckRepositoryName,
} from "../Repository/DatatruckRepository";
import {
  GitRepositoryConfigType,
  gitRepositoryName,
} from "../Repository/GitRepository";
import {
  ResticRepositoryConfigType,
  resticRepositoryName,
} from "../Repository/ResticRepository";
import type { JSONSchema7 } from "json-schema";

const types: Record<string, DefinitionEnum> = {
  [resticRepositoryName]: DefinitionEnum.resticRepository,
  [datatruckRepositoryName]: DefinitionEnum.datatruckRepository,
  [gitRepositoryName]: DefinitionEnum.gitRepository,
};

export const repositoryConfigDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["type", "name"],
  properties: {
    type: { type: "string" },
    name: { type: "string" },
    mirrorRepoNames: makeRef(DefinitionEnum.stringListUtil),
    enabled: {
      anyOf: [
        {
          type: "boolean",
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            defaults: { type: "boolean" },
            backup: { type: "boolean" },
            init: { type: "boolean" },
            prune: { type: "boolean" },
            restore: { type: "boolean" },
            snapshots: { type: "boolean" },
          },
        },
      ],
    },
    config: {},
  },
  anyOf: Object.keys(types).map(
    (type) =>
      ({
        if: {
          type: "object",
          properties: {
            type: { const: type },
          },
        },
        then: {
          type: "object",
          properties: {
            config: makeRef(types[type]),
          },
        },
        else: false,
      }) as JSONSchema7,
  ),
};

export type RepositoryConfigTypeType = RepositoryConfigType["type"];

export type RepositoryConfigEnabledActionType =
  | "backup"
  | "init"
  | "prune"
  | "restore"
  | "snapshots";

export type RepositoryConfigType = {
  name: string;
  mirrorRepoNames?: string[];
  enabled?:
    | boolean
    | {
        [K in "defaults" | RepositoryConfigEnabledActionType]?: boolean;
      };
} & (
  | {
      type: typeof resticRepositoryName;
      config: ResticRepositoryConfigType;
    }
  | {
      type: typeof datatruckRepositoryName;
      config: DatatruckRepositoryConfigType;
    }
  | {
      type: typeof gitRepositoryName;
      config: GitRepositoryConfigType;
    }
);
