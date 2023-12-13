import {
  DatatruckRepositoryConfig,
  datatruckRepositoryName,
} from "../repositories/DatatruckRepository";
import {
  GitRepositoryConfig,
  gitRepositoryName,
} from "../repositories/GitRepository";
import {
  ResticRepositoryConfig,
  resticRepositoryName,
} from "../repositories/ResticRepository";

export type RepositoryConfigType = RepositoryConfig["type"];

export type RepositoryConfigEnabledAction =
  | "backup"
  | "init"
  | "prune"
  | "restore"
  | "snapshots";

export type RepositoryEnabledObject = {
  [K in "defaults" | RepositoryConfigEnabledAction]?: boolean;
};

export type ResticRepositoryConfigItem = {
  type: typeof resticRepositoryName;
  config: ResticRepositoryConfig;
};

export type DatatruckRepositoryConfigItem = {
  type: typeof datatruckRepositoryName;
  config: DatatruckRepositoryConfig;
};

export type GitRepositoryConfigItem = {
  type: typeof gitRepositoryName;
  config: GitRepositoryConfig;
};

type CommonRepositoryConfig = {
  name: string;
  mirrorRepoNames?: string[];
  enabled?: boolean | RepositoryEnabledObject;
};

export type RepositoryConfig = CommonRepositoryConfig &
  (
    | ResticRepositoryConfigItem
    | DatatruckRepositoryConfigItem
    | GitRepositoryConfigItem
  );
