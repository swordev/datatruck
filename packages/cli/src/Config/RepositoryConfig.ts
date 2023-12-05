import {
  DatatruckRepositoryConfig,
  datatruckRepositoryName,
} from "../Repository/DatatruckRepository";
import {
  GitRepositoryConfig,
  gitRepositoryName,
} from "../Repository/GitRepository";
import {
  ResticRepositoryConfig,
  resticRepositoryName,
} from "../Repository/ResticRepository";

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
