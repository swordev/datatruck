import { BackupActionOptions } from "../actions/BackupAction";
import { RestoreActionOptions } from "../actions/RestoreAction";
import { PreSnapshot } from "../repositories/RepositoryAbstract";
import type { PackageConfig } from "../utils/datatruck/config-type";
import { Progress } from "../utils/progress";

type TaskCommonData = {
  package: PackageConfig;
  snapshot: PreSnapshot;
};

export type TaskBackupData = TaskCommonData & {
  onProgress: (data: Progress) => void;
  options: BackupActionOptions;
  snapshotPath?: string;
};

export type TaskRestoreData = TaskCommonData & {
  onProgress: (data: Progress) => void;
  options: RestoreActionOptions;
  snapshotPath: string;
};

export type TaskPrepareRestoreData = TaskCommonData & {
  options: RestoreActionOptions;
};

export type TaskReturn = Promise<{ snapshotPath?: string } | undefined>;

export abstract class TaskAbstract<TConfig = any> {
  constructor(readonly config: TConfig) {}
  async backup(data: TaskBackupData): TaskReturn {
    return;
  }
  async prepareRestore(data: TaskPrepareRestoreData): TaskReturn {
    return;
  }
  async restore(data: TaskRestoreData) {}
}
