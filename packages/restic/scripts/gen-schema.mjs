// @ts-check
import { writeFileSync } from "fs";
import { programFromConfig, generateSchema } from "typescript-json-schema";

const program = programFromConfig("./packages/restic/tsconfig.build.json");
const schema = generateSchema(program, "Config", {
  noExtraProps: true,
  ref: true,
  required: true,
});

const jsonSchema = JSON.stringify(schema, null, 2);
const paths = [`./packages/restic/config.schema.json`];
for (const path of paths) writeFileSync(path, jsonSchema);
