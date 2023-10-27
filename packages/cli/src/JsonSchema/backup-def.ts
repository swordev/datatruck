import { repositoryNames } from "../Config/RepositoryConfig";
import { JSONSchema7 } from "json-schema";

export const backupCommandOptionDef = {
  type: "object",
  additionalProperties: false,
  properties: {
    package: { type: "string" },
    packageTask: { type: "string" },
    repository: { type: "string" },
    repositoryType: { enum: repositoryNames },
    tag: { type: "string" },
    dryRun: { type: "boolean" },
    date: { type: "string" },
    prune: { type: "boolean" },
  },
} satisfies JSONSchema7;
