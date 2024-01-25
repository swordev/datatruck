import type { GitTaskConfig, gitTaskName } from "../../tasks/GitTask";
import type {
  MariadbTaskConfig,
  mariadbTaskName,
} from "../../tasks/MariadbTask";
import {
  MongoDumpTaskConfig,
  mongodumpTaskName,
} from "../../tasks/MongoDumpTask";
import type { MssqlTaskConfig, mssqlTaskName } from "../../tasks/MssqlTask";
import type {
  MysqlDumpTaskConfig,
  mysqlDumpTaskName,
} from "../../tasks/MysqlDumpTask";
import type {
  PostgresqlDumpTaskConfig,
  postgresqlDumpTaskName,
} from "../../tasks/PostgresqlDumpTask";
import type { ScriptTaskConfig, scriptTaskName } from "../../tasks/ScriptTask";

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

export type MongodumpTaskConfigItem = {
  name: typeof mongodumpTaskName;
  config: MongoDumpTaskConfig;
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
  | MongodumpTaskConfigItem
  | ScriptTaskConfigItem;
