import type { BackupActionOptions } from "../Action/BackupAction";
import type { InitActionOptions } from "../Action/InitAction";
import type { RestoreActionOptions } from "../Action/RestoreAction";
import type {
  ExtendedSnapshot,
  SnapshotsActionOptions,
} from "../Action/SnapshotsAction";
import type { PackageConfigType } from "../Config/PackageConfig";
import type { RepositoryConfigType } from "../Config/RepositoryConfig";
import { Progress } from "../utils/progress";

export type PreSnapshot = {
  id: string;
  date: string;
};

export type Snapshot = PreSnapshot & {
  originalId: string;
  packageName: string;
  packageTaskName: string | undefined;
  tags: string[];
  size: number;
};

export type RepoInitData = {
  options: InitActionOptions;
};

export type RepoFetchSnapshotsData = {
  options: Pick<
    SnapshotsActionOptions,
    "ids" | "packageNames" | "packageTaskNames" | "verbose" | "tags"
  >;
};

export type RepoCopyData<TRepositoryConfig> = {
  options: BackupActionOptions;
  snapshot: PreSnapshot;
  package: PackageConfigType;
  mirrorRepositoryConfig: TRepositoryConfig;
  onProgress: (data: Progress) => void;
};

export type RepoBackupData<TPackageConfig> = {
  options: BackupActionOptions;
  snapshot: PreSnapshot;
  package: Omit<PackageConfigType, "path"> & { path: string };
  packageConfig: TPackageConfig | undefined;
  onProgress: (data: Progress) => void;
};

export type RepoRestoreData<TPackageConfig> = {
  options: RestoreActionOptions;
  snapshot: PreSnapshot;
  package: PackageConfigType;
  snapshotPath: string;
  packageConfig: TPackageConfig;
  onProgress: (data: Progress) => void;
};

export type RepoPruneData = {
  snapshot: ExtendedSnapshot;
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
  constructor(readonly repository: RepositoryConfigType) {
    this.config = repository.config as never;
  }
  abstract getSource(): string;
  abstract init(data: RepoInitData): Promise<void>;
  abstract prune(data: RepoPruneData): Promise<void>;
  abstract fetchSnapshots(data: RepoFetchSnapshotsData): Promise<Snapshot[]>;
  abstract copy(data: RepoCopyData<TConfig>): Promise<void>;
  abstract backup(data: RepoBackupData<unknown>): Promise<void>;
  abstract restore(data: RepoRestoreData<unknown>): Promise<void>;
}
