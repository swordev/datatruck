import { JSONSchema7 } from "json-schema";

export const copyCommandOptionsDef = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    last: { type: "integer" },
    package: { type: "string" },
    packageTask: { type: "string" },
    repository: { type: "string" },
    repository2: { type: "string" },
  },
} satisfies JSONSchema7;
