import { TaskConfigType } from "../Config/TaskConfig";
import { AppError } from "../Error/AppError";
import { GitTask, gitTaskName } from "../Task/GitTask";
import { MariadbTask, mariadbTaskName } from "../Task/MariadbTask";
import { MssqlTask, mssqlTaskName } from "../Task/MssqlTask";
import { MysqlDumpTask, mysqlDumpTaskName } from "../Task/MysqlDumpTask";
import {
  PostgresqlDumpTask,
  postgresqlDumpTaskName,
} from "../Task/PostgresqlDumpTask";
import type { TaskAbstract } from "../Task/TaskAbstract";

export function TaskFactory(task: TaskConfigType): TaskAbstract {
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
  } else {
    throw new AppError(`Invalid task name: ${task["name"]}`);
  }
}
