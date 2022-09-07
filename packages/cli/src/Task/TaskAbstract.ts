import { BackupActionOptionsType } from "../Action/BackupAction";
import { RestoreActionOptionsType } from "../Action/RestoreAction";
import { PackageConfigType } from "../Config/PackageConfig";
import { SnapshotType } from "../Repository/RepositoryAbstract";
import { Progress } from "../util/progress";

export type BackupDataType = {
  onProgress: (data: Progress) => Promise<void>;
  options: BackupActionOptionsType;
  package: PackageConfigType;
  targetPath: string | undefined;
  snapshot: SnapshotType;
};

export type RestoreDataType = {
  onProgress: (data: Progress) => Promise<void>;
  options: RestoreActionOptionsType;
  package: PackageConfigType;
  targetPath: string | undefined;
  snapshot: SnapshotType;
};

export abstract class TaskAbstract<TConfig = any> {
  constructor(readonly config: TConfig) {}

  async onBeforeBackup(
    data: Omit<BackupDataType, "onProgress" | "targetPath">
  ): Promise<{ targetPath?: string } | undefined> {
    return undefined;
  }
  async onBackup(data: BackupDataType) {}
  async onBeforeRestore(
    data: Omit<RestoreDataType, "onProgress" | "targetPath">
  ): Promise<{ targetPath?: string } | undefined> {
    return undefined;
  }
  async onRestore(data: RestoreDataType) {}
}
