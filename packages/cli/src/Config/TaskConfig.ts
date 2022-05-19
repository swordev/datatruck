import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { GitTaskConfigType, gitTaskName } from "../Task/GitTask";
import { MariadbTaskConfigType, mariadbTaskName } from "../Task/MariadbTask";
import { MssqlTaskConfigType, mssqlTaskName } from "../Task/MssqlTask";
import {
  MysqlDumpTaskConfigType,
  mysqlDumpTaskName,
} from "../Task/MysqlDumpTask";
import {
  PostgresqlDumpTaskConfigType,
  postgresqlDumpTaskName,
} from "../Task/PostgresqlDumpTask";
import { ScriptTaskConfigType, scriptTaskName } from "../Task/ScriptTask";
import { JSONSchema7 } from "json-schema";

const names: Record<string, DefinitionEnum> = {
  [gitTaskName]: DefinitionEnum.gitTask,
  [mariadbTaskName]: DefinitionEnum.mariadbTask,
  [mssqlTaskName]: DefinitionEnum.mssqlTask,
  [mysqlDumpTaskName]: DefinitionEnum.mysqlDumpTask,
  [postgresqlDumpTaskName]: DefinitionEnum.postgresqlDumpTask,
  [scriptTaskName]: DefinitionEnum.scriptTask,
};

export const taskConfigDefinition: JSONSchema7 = {
  type: "object",
  required: ["name"],
  properties: {
    name: { enum: Object.keys(names) },
    config: {},
  },
  anyOf: Object.keys(names).map(
    (name) =>
      ({
        if: {
          type: "object",
          properties: {
            name: { const: name },
          },
        },
        then: {
          type: "object",
          properties: {
            config: makeRef(names[name]),
          },
        },
        else: false,
      } as JSONSchema7)
  ),
};

export type TaskConfigType =
  | {
      name: typeof gitTaskName;
      config?: GitTaskConfigType;
    }
  | {
      name: typeof mariadbTaskName;
      config: MariadbTaskConfigType;
    }
  | {
      name: typeof mssqlTaskName;
      config: MssqlTaskConfigType;
    }
  | {
      name: typeof mysqlDumpTaskName;
      config: MysqlDumpTaskConfigType;
    }
  | {
      name: typeof postgresqlDumpTaskName;
      config: PostgresqlDumpTaskConfigType;
    }
  | {
      name: typeof scriptTaskName;
      config: ScriptTaskConfigType;
    };
