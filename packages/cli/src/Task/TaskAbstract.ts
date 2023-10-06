import { BackupActionOptions } from "../Action/BackupAction";
import { RestoreActionOptions } from "../Action/RestoreAction";
import { PackageConfigType } from "../Config/PackageConfig";
import { PreSnapshot } from "../Repository/RepositoryAbstract";
import { Progress } from "../utils/progress";

type TaskCommonData = {
  package: PackageConfigType;
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

export type TaskReturn = Promise<{ snapshotPath?: string } | undefined | void>;

export abstract class TaskAbstract<TConfig = any> {
  constructor(readonly config: TConfig) {}
  async backup(data: TaskBackupData): TaskReturn {}
  async prepareRestore(data: TaskPrepareRestoreData): TaskReturn {}
  async restore(data: TaskRestoreData) {}
}
