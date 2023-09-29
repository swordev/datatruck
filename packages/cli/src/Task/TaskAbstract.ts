import { BackupActionOptionsType } from "../Action/BackupAction";
import { RestoreActionOptionsType } from "../Action/RestoreAction";
import { PackageConfigType } from "../Config/PackageConfig";
import { SnapshotType } from "../Repository/RepositoryAbstract";
import { mkTmpDir } from "../utils/fs";
import { Progress } from "../utils/progress";

export type BackupDataType = {
  onProgress: (data: Progress) => Promise<void>;
  options: BackupActionOptionsType;
  package: PackageConfigType;
  targetPath: string | undefined;
  snapshot: SnapshotType;
};

export type BeforeBackupDataType = Omit<
  BackupDataType,
  "onProgress" | "targetPath"
>;

export type RestoreDataType = {
  onProgress: (data: Progress) => Promise<void>;
  options: RestoreActionOptionsType;
  package: PackageConfigType;
  targetPath: string | undefined;
  snapshot: SnapshotType;
};

export type BeforeRestoreDataType = Omit<
  RestoreDataType,
  "onProgress" | "targetPath"
>;

export type BeforeReturn = Promise<{ targetPath?: string } | undefined | void>;

export abstract class TaskAbstract<TConfig = any> {
  readonly tmpDirs: string[] = [];
  constructor(readonly config: TConfig) {}
  async mkTmpDir(prefix: string, id?: string) {
    const dir = await mkTmpDir(prefix, id);
    this.tmpDirs.push(dir);
    return dir;
  }
  async onBeforeBackup(data: BeforeBackupDataType): BeforeReturn {}
  async onBackup(data: BackupDataType) {}
  async onBeforeRestore(data: BeforeRestoreDataType): BeforeReturn {}
  async onRestore(data: RestoreDataType) {}
}
