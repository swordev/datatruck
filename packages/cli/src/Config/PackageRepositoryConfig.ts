import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import {
  GitPackageRepositoryConfigType,
  gitRepositoryName,
} from "../Repository/GitRepository";
import {
  LocalPackageRepositoryConfigType,
  localRepositoryName,
} from "../Repository/LocalRepository";
import {
  ResticPackageRepositoryConfigType,
  resticRepositoryName,
} from "../Repository/ResticRepository";
import type { JSONSchema7 } from "json-schema";

const types: Record<string, DefinitionEnum> = {
  [resticRepositoryName]: DefinitionEnum.resticPackageRepository,
  [localRepositoryName]: DefinitionEnum.localPackageRepository,
  [gitRepositoryName]: DefinitionEnum.gitPackageRepository,
};

export const packageRepositoryConfigDefinition: JSONSchema7 = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    type: { type: "string" },
    names: makeRef(DefinitionEnum.stringListUtil),
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
      } as JSONSchema7)
  ),
};

export type PackageRepositoryConfigType = {
  names?: string[];
} & (
  | {
      type: typeof resticRepositoryName;
      config: ResticPackageRepositoryConfigType;
    }
  | {
      type: typeof localRepositoryName;
      config: LocalPackageRepositoryConfigType;
    }
  | {
      type: typeof gitRepositoryName;
      config: GitPackageRepositoryConfigType;
    }
);
