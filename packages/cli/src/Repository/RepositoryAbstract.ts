import type { BackupActionOptionsType } from "../Action/BackupAction";
import type { InitActionOptionsType } from "../Action/InitAction";
import type { RestoreActionOptionsType } from "../Action/RestoreAction";
import type {
  SnapshotExtendedType,
  SnapshotsActionOptionsType,
} from "../Action/SnapshotsAction";
import type { PackageConfigType } from "../Config/PackageConfig";
import type { RepositoryConfigType } from "../Config/RepositoryConfig";
import { mkTmpDir } from "../utils/fs";
import { Progress } from "../utils/progress";

export type SnapshotType = {
  id: string;
  date: string;
};

export type SnapshotResultType = SnapshotType & {
  originalId: string;
  packageName: string;
  packageTaskName: string | undefined;
  tags: string[];
  size: number;
};

export type InitDataType = {
  options: InitActionOptionsType;
};

export type SnapshotsDataType = {
  options: Pick<
    SnapshotsActionOptionsType,
    "ids" | "packageNames" | "packageTaskNames" | "verbose" | "tags"
  >;
};

export type CopyBackupType<TRepositoryConfig> = {
  options: BackupActionOptionsType;
  snapshot: SnapshotType;
  package: PackageConfigType;
  mirrorRepositoryConfig: TRepositoryConfig;
  onProgress: (data: Progress) => Promise<void>;
};

export type BackupDataType<TPackageConfig> = {
  options: BackupActionOptionsType;
  snapshot: SnapshotType;
  package: PackageConfigType;
  targetPath: string | undefined;
  packageConfig: TPackageConfig | undefined;
  onProgress: (data: Progress) => Promise<void>;
};

export type RestoreDataType<TPackageConfig> = {
  options: RestoreActionOptionsType;
  snapshot: SnapshotType;
  package: PackageConfigType;
  targetPath: string | undefined;
  packageConfig: TPackageConfig;
  onProgress: (data: Progress) => Promise<void>;
};

export type PruneDataType = {
  snapshot: SnapshotExtendedType;
  options: { verbose?: boolean };
};

export enum SnapshotTagEnum {
  ID = "id",
  SHORT_ID = "shortId",
  DATE = "date",
  PACKAGE = "package",
  TASK = "task",
  TAGS = "tags",
  VERSION = "version",
  SIZE = "size",
}

export type SnapshotTagObjectType = {
  [SnapshotTagEnum.ID]: string;
  [SnapshotTagEnum.SHORT_ID]: string;
  [SnapshotTagEnum.DATE]: string;
  [SnapshotTagEnum.PACKAGE]: string;
  [SnapshotTagEnum.TASK]: string | undefined;
  [SnapshotTagEnum.TAGS]: string[];
  [SnapshotTagEnum.VERSION]: string;
  [SnapshotTagEnum.SIZE]: string;
};

export abstract class RepositoryAbstract<TConfig> {
  readonly config: TConfig;
  readonly tmpDirs: string[] = [];
  constructor(readonly repository: RepositoryConfigType) {
    this.config = repository.config as never;
  }
  async mkTmpDir(prefix: string, id?: string) {
    const dir = await mkTmpDir(prefix, id);
    this.tmpDirs.push(dir);
    return dir;
  }
  abstract onGetSource(): string;
  abstract onInit(data: InitDataType): Promise<void>;
  abstract onPrune(data: PruneDataType): Promise<void>;
  abstract onSnapshots(data: SnapshotsDataType): Promise<SnapshotResultType[]>;
  abstract onCopyBackup(data: CopyBackupType<TConfig>): Promise<void>;
  abstract onBackup(data: BackupDataType<unknown>): Promise<void>;
  abstract onRestore(data: RestoreDataType<unknown>): Promise<void>;
}
