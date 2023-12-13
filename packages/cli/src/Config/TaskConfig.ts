import { GitTaskConfig, gitTaskName } from "../tasks/GitTask";
import { MariadbTaskConfig, mariadbTaskName } from "../tasks/MariadbTask";
import { MssqlTaskConfig, mssqlTaskName } from "../tasks/MssqlTask";
import { MysqlDumpTaskConfig, mysqlDumpTaskName } from "../tasks/MysqlDumpTask";
import {
  PostgresqlDumpTaskConfig,
  postgresqlDumpTaskName,
} from "../tasks/PostgresqlDumpTask";
import { ScriptTaskConfig, scriptTaskName } from "../tasks/ScriptTask";

export type GitTaskConfigItem = {
  name: typeof gitTaskName;
  config: GitTaskConfig;
};

export type MariadbTaskConfigItem = {
  name: typeof mariadbTaskName;
  config: MariadbTaskConfig;
};

export type MssqlTaskConfigItem = {
  name: typeof mssqlTaskName;
  config: MssqlTaskConfig;
};

export type MysqlDumpTaskConfigItem = {
  name: typeof mysqlDumpTaskName;
  config: MysqlDumpTaskConfig;
};

export type PostgresqlDumpTaskConfigItem = {
  name: typeof postgresqlDumpTaskName;
  config: PostgresqlDumpTaskConfig;
};

export type ScriptTaskConfigItem = {
  name: typeof scriptTaskName;
  config: ScriptTaskConfig;
};

export type TaskConfig =
  | GitTaskConfigItem
  | MariadbTaskConfigItem
  | MssqlTaskConfigItem
  | MysqlDumpTaskConfigItem
  | PostgresqlDumpTaskConfigItem
  | ScriptTaskConfigItem;
