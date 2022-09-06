import { BackupActionOptionsType } from "../Action/BackupAction";
import { RestoreActionOptionsType } from "../Action/RestoreAction";
import { PackageConfigType } from "../Config/PackageConfig";
import { SnapshotType } from "../Repository/RepositoryAbstract";

export type ProgressDataType = {
  stats?: {
    total?: number;
    current?: number;
    percent?: number;
  };
  step?: {
    description?: string;
    item?: string;
    percent?: number;
  };
};

export type BackupDataType = {
  onProgress: (data: ProgressDataType) => Promise<void>;
  options: BackupActionOptionsType;
  package: PackageConfigType;
  targetPath: string | undefined;
  snapshot: SnapshotType;
};

export type RestoreDataType = {
  onProgress: (data: ProgressDataType) => Promise<void>;
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
