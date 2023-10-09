import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { DatatruckServerOptions } from "../utils/datatruck/server";
import { PackageConfigType } from "./PackageConfig";
import { RepositoryConfigType } from "./RepositoryConfig";
import type { JSONSchema7 } from "json-schema";

export type ConfigType = {
  tempDir?: string;
  minFreeDiskSpace?: string | number;
  repositories: RepositoryConfigType[];
  packages: PackageConfigType[];
  server?: DatatruckServerOptions;
};

export const configDefinition: JSONSchema7 = {
  type: "object",
  required: ["repositories", "packages"],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    tempDir: { type: "string" },
    minFreeDiskSpace: { anyOf: [{ type: "integer" }, { type: "string" }] },
    repositories: {
      type: "array",
      items: makeRef(DefinitionEnum.repository),
    },
    packages: {
      type: "array",
      items: makeRef(DefinitionEnum.package),
    },
    server: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        users: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              password: { type: "string" },
            },
          },
        },
        listen: {
          type: "object",
          additionalProperties: false,
          properties: {
            port: { type: "integer" },
            address: { type: "string" },
          },
        },
      },
    },
  },
};
