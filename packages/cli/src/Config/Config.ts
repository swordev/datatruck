import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { PackageConfigType } from "./PackageConfig";
import { RepositoryConfigType } from "./RepositoryConfig";
import type { JSONSchema7 } from "json-schema";

export type ConfigType = {
  tempDir?: string;
  repositories: RepositoryConfigType[];
  packages: PackageConfigType[];
};

export const configDefinition: JSONSchema7 = {
  type: "object",
  required: ["repositories", "packages"],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    tempDir: { type: "string" },
    repositories: {
      type: "array",
      items: makeRef(DefinitionEnum.repository),
    },
    packages: {
      type: "array",
      items: makeRef(DefinitionEnum.package),
    },
  },
};
