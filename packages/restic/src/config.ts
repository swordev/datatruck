import { parseJSONFile } from "./utils/fs.js";
import { Ajv, ValidateFunction } from "ajv";

export type GlobalConfig = {
  config?: string;
  verbose?: boolean;
};

export type Config = {
  $schema?: string;
  hostname?: string;
  ntfyToken?: string;
  minFreeSpace?: string;
  verbose?: boolean;
  tasks?: {
    type: "mysql-dump";
    packages: string[];
    name: string;
    config: {
      database: string;
      out:
        | {
            package?: string;
            tables: string[];
            path: string | false;
          }[]
        | string;
      concurrency?: number;
      connection: {
        hostname: string;
        username: string;
        password: string;
        database?: string;
      };
    };
  }[];
  packages: {
    name: string;
    path: string;
    exclude?: string[];
  }[];
  repositories: {
    name: string;
    password: string;
    uri: string;
  }[];
};

export function defineConfig(config: Config): Config {
  return config;
}

let validate: ValidateFunction<any> | undefined;

export async function validateConfig(config: unknown) {
  if (!validate) {
    const schema = await readConfigSchemaFile();
    validate = new Ajv({ allowUnionTypes: true }).compile(schema as any);
  }
  if (!validate(config))
    throw new Error(
      "Json schema error: " + JSON.stringify(validate.errors, null, 2),
    );
}

export async function readConfigSchemaFile() {
  return parseJSONFile(`${import.meta.dirname}/../config.schema.json`);
}

export async function parseConfigFile(
  path: string = "datatruck.restic.json",
): Promise<Config> {
  const config = await parseJSONFile<Config>(path);
  await validateConfig(config);
  return config;
}
