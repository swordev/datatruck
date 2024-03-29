import { GitTask, gitTaskName } from "../../tasks/GitTask";
import { MariadbTask, mariadbTaskName } from "../../tasks/MariadbTask";
import { MongoDumpTask, mongodumpTaskName } from "../../tasks/MongoDumpTask";
import { MssqlTask, mssqlTaskName } from "../../tasks/MssqlTask";
import { MysqlDumpTask, mysqlDumpTaskName } from "../../tasks/MysqlDumpTask";
import {
  PostgresqlDumpTask,
  postgresqlDumpTaskName,
} from "../../tasks/PostgresqlDumpTask";
import { ScriptTask, scriptTaskName } from "../../tasks/ScriptTask";
import type { TaskAbstract } from "../../tasks/TaskAbstract";
import { AppError } from "../error";
import type { TaskConfig } from "./config-type";

export function createTask(task: TaskConfig): TaskAbstract {
  if (task.name === gitTaskName) {
    return new GitTask(task.config ?? {});
  } else if (task.name === mariadbTaskName) {
    return new MariadbTask(task.config ?? {});
  } else if (task.name === mysqlDumpTaskName) {
    return new MysqlDumpTask(task.config ?? {});
  } else if (task.name === postgresqlDumpTaskName) {
    return new PostgresqlDumpTask(task.config ?? {});
  } else if (task.name === mssqlTaskName) {
    return new MssqlTask(task.config ?? {});
  } else if (task.name === mongodumpTaskName) {
    return new MongoDumpTask(task.config ?? {});
  } else if (task.name === scriptTaskName) {
    return new ScriptTask(task.config ?? {});
  } else {
    throw new AppError(`Invalid task name: ${task["name"]}`);
  }
}
