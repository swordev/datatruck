import type { BackupActionOptions } from "../actions/BackupAction";
import type { RestoreActionOptions } from "../actions/RestoreAction";
import type {
  ExtendedSnapshot,
  SnapshotsActionOptions,
} from "../actions/SnapshotsAction";
import type {
  PackageConfig,
  RepositoryConfig,
} from "../utils/datatruck/config-type";
import { ensureFreeDiskSpace, type DiskStats } from "../utils/fs";
import type { Progress } from "../utils/progress";

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
  options: {
    verbose?: boolean;
  };
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
  package: PackageConfig;
  mirrorRepositoryConfig: TRepositoryConfig;
  onProgress: (data: Progress) => void;
};

export type RepoBackupData<TPackageConfig> = {
  options: BackupActionOptions;
  snapshot: PreSnapshot;
  package: Omit<PackageConfig, "path"> & { path: string };
  packageConfig: TPackageConfig | undefined;
  onProgress: (data: Progress) => void;
};

export type RepoRestoreData<TPackageConfig> = {
  options: RestoreActionOptions;
  snapshot: PreSnapshot;
  package: PackageConfig;
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

export type SnapshotTagObject = {
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
  constructor(readonly repository: RepositoryConfig) {
    this.config = repository.config as never;
  }
  abstract getSource(): string;
  abstract fetchDiskStats(config: TConfig): Promise<DiskStats | undefined>;
  async ensureFreeDiskSpace(
    config: TConfig,
    minFreeDiskSpace: number | string,
  ) {
    const diskStats = await this.fetchDiskStats(config);
    if (diskStats) await ensureFreeDiskSpace(diskStats, minFreeDiskSpace);
  }
  abstract init(data: RepoInitData): Promise<void>;
  abstract prune(data: RepoPruneData): Promise<void>;
  abstract fetchSnapshots(data: RepoFetchSnapshotsData): Promise<Snapshot[]>;
  abstract copy(data: RepoCopyData<TConfig>): Promise<{ bytes: number }>;
  abstract backup(data: RepoBackupData<unknown>): Promise<{ bytes: number }>;
  abstract restore(data: RepoRestoreData<unknown>): Promise<void>;
}
