import { GitTaskConfig, gitTaskName } from "../Task/GitTask";
import { MariadbTaskConfig, mariadbTaskName } from "../Task/MariadbTask";
import { MssqlTaskConfig, mssqlTaskName } from "../Task/MssqlTask";
import { MysqlDumpTaskConfig, mysqlDumpTaskName } from "../Task/MysqlDumpTask";
import {
  PostgresqlDumpTaskConfig,
  postgresqlDumpTaskName,
} from "../Task/PostgresqlDumpTask";
import { ScriptTaskConfig, scriptTaskName } from "../Task/ScriptTask";

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
