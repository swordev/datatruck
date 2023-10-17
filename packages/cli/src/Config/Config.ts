import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { ScriptTaskDefinitionEnum } from "../Task/ScriptTask";
import { FormatType, dataFormats } from "../utils/DataFormat";
import { DatatruckServerOptions } from "../utils/datatruck/server";
import { Step } from "../utils/steps";
import { PackageConfigType } from "./PackageConfig";
import { PrunePolicyConfigType } from "./PrunePolicyConfig";
import { RepositoryConfigType } from "./RepositoryConfig";
import type { JSONSchema7 } from "json-schema";

export type ConfigType = {
  tempDir?: string;
  minFreeDiskSpace?: string | number;
  repositories: RepositoryConfigType[];
  packages: PackageConfigType[];
  server?: DatatruckServerOptions;
  reports?: ReportConfig[];
  prunePolicy?: PrunePolicyConfigType;
};

export type ReportConfig = {
  when?: "success" | "error";
  format?: Exclude<FormatType, "custom" | "tpl">;
  run: Step;
};

export const configDefinition: JSONSchema7 = {
  type: "object",
  required: ["repositories", "packages"],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    tempDir: { type: "string" },
    minFreeDiskSpace: { anyOf: [{ type: "integer" }, { type: "string" }] },
    reports: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          when: { enum: ["success", "error"] },
          format: {
            enum: dataFormats.filter((f) => !["custom", "tpl"].includes(f)),
          },
          run: makeRef(
            DefinitionEnum.scriptTask,
            ScriptTaskDefinitionEnum.step,
          ),
        },
      },
    },
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
    prunePolicy: makeRef(DefinitionEnum.prunePolicy),
  },
};
