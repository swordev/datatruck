import { DefinitionEnum, makeRef } from "../JsonSchema/DefinitionEnum";
import { GitTaskConfig, gitTaskName } from "../Task/GitTask";
import { MariadbTaskConfig, mariadbTaskName } from "../Task/MariadbTask";
import { MssqlTaskConfig, mssqlTaskName } from "../Task/MssqlTask";
import { MysqlDumpTaskConfig, mysqlDumpTaskName } from "../Task/MysqlDumpTask";
import {
  PostgresqlDumpTaskConfig,
  postgresqlDumpTaskName,
} from "../Task/PostgresqlDumpTask";
import { ScriptTaskConfig, scriptTaskName } from "../Task/ScriptTask";
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
      }) as JSONSchema7,
  ),
};

export type TaskConfig =
  | {
      name: typeof gitTaskName;
      config?: GitTaskConfig;
    }
  | {
      name: typeof mariadbTaskName;
      config: MariadbTaskConfig;
    }
  | {
      name: typeof mssqlTaskName;
      config: MssqlTaskConfig;
    }
  | {
      name: typeof mysqlDumpTaskName;
      config: MysqlDumpTaskConfig;
    }
  | {
      name: typeof postgresqlDumpTaskName;
      config: PostgresqlDumpTaskConfig;
    }
  | {
      name: typeof scriptTaskName;
      config: ScriptTaskConfig;
    };
