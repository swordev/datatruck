import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import {
  DatatruckRepositoryConfig,
  datatruckRepositoryName,
} from "../Repository/DatatruckRepository";
import {
  GitRepositoryConfig,
  gitRepositoryName,
} from "../Repository/GitRepository";
import {
  ResticRepositoryConfig,
  resticRepositoryName,
} from "../Repository/ResticRepository";
import type { JSONSchema7 } from "json-schema";

const types: Record<string, DefinitionEnum> = {
  [resticRepositoryName]: DefinitionEnum.resticRepository,
  [datatruckRepositoryName]: DefinitionEnum.datatruckRepository,
  [gitRepositoryName]: DefinitionEnum.gitRepository,
};

export const repositoryNames = [
  resticRepositoryName as typeof resticRepositoryName,
  datatruckRepositoryName as typeof datatruckRepositoryName,
  gitRepositoryName as typeof gitRepositoryName,
];

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

export type RepositoryConfigType = RepositoryConfig["type"];

export type RepositoryConfigEnabledAction =
  | "backup"
  | "init"
  | "prune"
  | "restore"
  | "snapshots";

export type RepositoryEnabledObject = {
  [K in "defaults" | RepositoryConfigEnabledAction]?: boolean;
};

export type RepositoryConfig = {
  name: string;
  mirrorRepoNames?: string[];
  enabled?: boolean | RepositoryEnabledObject;
} & (
  | {
      type: typeof resticRepositoryName;
      config: ResticRepositoryConfig;
    }
  | {
      type: typeof datatruckRepositoryName;
      config: DatatruckRepositoryConfig;
    }
  | {
      type: typeof gitRepositoryName;
      config: GitRepositoryConfig;
    }
);
