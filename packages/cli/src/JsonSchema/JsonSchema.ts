import { configDefinition } from "../Config/Config";
import {
  pathsObjectDefinition,
  packageConfigDefinition,
} from "../Config/PackageConfig";
import { packageRepositoryConfigDefinition } from "../Config/PackageRepositoryConfig";
import { prunePolicyConfigDefinition } from "../Config/PrunePolicyConfig";
import { repositoryConfigDefinition } from "../Config/RepositoryConfig";
import { taskConfigDefinition } from "../Config/TaskConfig";
import {
  datatruckPackageRepositoryDefinition,
  datatruckRepositoryDefinition,
} from "../Repository/DatatruckRepository";
import {
  gitPackageRepositoryDefinition,
  gitRepositoryDefinition,
} from "../Repository/GitRepository";
import {
  resticPackageRepositoryDefinition,
  resticRepositoryDefinition,
} from "../Repository/ResticRepository";
import { gitTaskDefinition } from "../Task/GitTask";
import { mariadbTaskDefinition } from "../Task/MariadbTask";
import { mssqlTaskDefinition } from "../Task/MssqlTask";
import { mysqlDumpTaskDefinition } from "../Task/MysqlDumpTask";
import { postgresqlDumpTaskDefinition } from "../Task/PostgresqlDumpTask";
import { scriptTaskDefinition } from "../Task/ScriptTask";
import { sqlDumpTaskDefinition } from "../Task/SqlDumpTaskAbstract";
import { compressDefinition } from "../utils/tar";
import { DefinitionEnum, makeRef } from "./DefinitionEnum";
import { JSONSchema7 } from "json-schema";

export const definitions: Record<DefinitionEnum, JSONSchema7> = {
  [DefinitionEnum.stringListUtil]: {
    type: "array",
    items: {
      type: "string",
    },
  },
  [DefinitionEnum.repository]: repositoryConfigDefinition,
  [DefinitionEnum.package]: packageConfigDefinition,
  [DefinitionEnum.packageRepository]: packageRepositoryConfigDefinition,
  [DefinitionEnum.task]: taskConfigDefinition,
  [DefinitionEnum.gitRepository]: gitRepositoryDefinition,
  [DefinitionEnum.gitPackageRepository]: gitPackageRepositoryDefinition,
  [DefinitionEnum.datatruckRepository]: datatruckRepositoryDefinition,
  [DefinitionEnum.datatruckPackageRepository]:
    datatruckPackageRepositoryDefinition,
  [DefinitionEnum.resticRepository]: resticRepositoryDefinition,
  [DefinitionEnum.resticPackageRepository]: resticPackageRepositoryDefinition,
  [DefinitionEnum.gitTask]: gitTaskDefinition,
  [DefinitionEnum.scriptTask]: scriptTaskDefinition,
  [DefinitionEnum.sqlDumpTask]: sqlDumpTaskDefinition,
  [DefinitionEnum.mariadbTask]: mariadbTaskDefinition,
  [DefinitionEnum.mssqlTask]: mssqlTaskDefinition,
  [DefinitionEnum.mysqlDumpTask]: mysqlDumpTaskDefinition,
  [DefinitionEnum.postgresqlDumpTask]: postgresqlDumpTaskDefinition,
  [DefinitionEnum.config]: configDefinition,
  [DefinitionEnum.prunePolicy]: prunePolicyConfigDefinition,
  [DefinitionEnum.pathsObject]: pathsObjectDefinition,
  [DefinitionEnum.compressUtil]: compressDefinition,
};

for (const key in definitions) {
  const schemaKey = key as keyof typeof definitions;
  const schema = definitions[schemaKey];
  for (const defName in schema.definitions || {}) {
    (definitions as any)[`${schemaKey}_${defName}`] =
      schema.definitions![defName];
  }
  definitions[schemaKey] = {
    ...schema,
  };
  delete definitions[schemaKey].definitions;
}

export const schema: JSONSchema7 = {
  definitions: definitions,
  ...makeRef(DefinitionEnum.config),
};
