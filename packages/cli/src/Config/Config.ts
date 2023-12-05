import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { backupCommandOptionDef } from "../JsonSchema/backup-def";
import { copyCommandOptionsDef } from "../JsonSchema/copy-def";
import { ScriptTaskDefinitionEnum } from "../Task/ScriptTask";
import { DataFormatType, dataFormats } from "../utils/DataFormat";
import { DatatruckCronServerOptions } from "../utils/datatruck/cron-server";
import { DatatruckRepositoryServerOptions } from "../utils/datatruck/repository-server";
import { createCaseSchema, omitPropertySchema } from "../utils/schema";
import { Step } from "../utils/steps";
import { PackageConfig } from "./PackageConfig";
import { PrunePolicyConfig } from "./PrunePolicyConfig";
import { RepositoryConfig } from "./RepositoryConfig";
import type { JSONSchema7 } from "json-schema";

export type Config = {
  $schema?: string;
  tempDir?: string;
  minFreeDiskSpace?: string | number;
  repositories: RepositoryConfig[];
  packages: PackageConfig[];
  server?: DatatruckServerOptions;
  reports?: ReportConfig[];
  prunePolicy?: PrunePolicyConfig;
};

export type DatatruckServerOptions = {
  log?: boolean;
  repository?: DatatruckRepositoryServerOptions;
  cron?: DatatruckCronServerOptions;
};

export type ReportConfig = {
  when?: "success" | "error";
  format?: Exclude<DataFormatType, "custom" | "tpl">;
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
        log: { type: "boolean" },
        repository: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            listen: {
              type: "object",
              additionalProperties: false,
              properties: {
                port: { type: "integer" },
                address: { type: "string" },
              },
            },
            trustProxy: {
              anyOf: [
                { type: "boolean" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["remoteAddressHeader"],
                  properties: {
                    remoteAddressHeader: { type: "string" },
                  },
                },
              ],
            },
            allowlist: {
              type: "object",
              additionalProperties: false,
              properties: {
                enabled: { type: "boolean" },
                remoteAddresses: makeRef(DefinitionEnum.stringListUtil),
              },
            },
            backends: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "path"],
                properties: {
                  name: { type: "string" },
                  path: { type: "string" },
                  users: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["name", "password"],
                      properties: {
                        enabled: { type: "boolean" },
                        name: { type: "string" },
                        password: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        cron: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            actions: {
              type: "array",
              items: {
                allOf: [
                  {
                    type: "object",
                    required: ["schedule"],
                    properties: {
                      schedule: { type: "string" },
                    },
                  },
                  {
                    anyOf: createCaseSchema(
                      {
                        type: "type",
                        value: "options",
                      },
                      {
                        backup: omitPropertySchema(
                          backupCommandOptionDef,
                          "dryRun",
                        ),
                        copy: copyCommandOptionsDef,
                      },
                    ),
                  },
                ],
              },
            },
          },
        },
      },
    },
    prunePolicy: makeRef(DefinitionEnum.prunePolicy),
  },
};
