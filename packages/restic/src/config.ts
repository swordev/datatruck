import { parseJSONFile } from "./utils/fs.js";
import { MySQLDumpOptions } from "./utils/mysql.js";
import { match } from "@datatruck/cli/utils/string.js";
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
  prunePolicy?: PrunePolicy;
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
      connection: MySQLDumpOptions["connection"];
    };
  }[];
  packages: {
    name: string;
    path: string;
    exclude?: string[];
    prunePolicy?: PrunePolicy;
  }[];
  repositories: {
    name: string;
    password: string;
    uri: string;
    prunePolicy?: PrunePolicy;
  }[];
};

export type PrunePolicy = {
  keepMinutely?: number;
  keepDaily?: number;
  keepHourly?: number;
  keepLast?: number;
  keepMonthly?: number;
  keepWeekly?: number;
  keepYearly?: number;
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

export class ConfigManager {
  constructor(readonly config: Config) {}
  filterRepositories(filter: string[] | undefined) {
    const repositories = this.config.repositories.filter((v) =>
      filter ? match(v.name, filter) : true,
    );
    if (!repositories.length)
      throw new Error(
        `No repositories found for filter: ${filter?.join(", ")}`,
      );
    return repositories;
  }
  filterPackages(filter: string[] | undefined) {
    const packages = this.config.packages.filter((v) =>
      filter ? match(v.name, filter) : true,
    );
    if (!packages.length)
      throw new Error(`No packages found for filter: ${filter?.join(", ")}`);
    return packages;
  }
  findRepository(name: string) {
    const repo = this.config.repositories.find((repo) => repo.name === name);
    if (!repo) throw new Error(`Repository '${name}' not found`);
    return repo;
  }
  findPackage(name: string) {
    const pkg = this.config.packages.find((pkg) => pkg.name === name);
    if (!pkg) throw new Error(`Package '${name}' not found`);
    return pkg;
  }
}
