import type {
  DatatruckPackageRepositoryConfig,
  DatatruckRepositoryConfig,
  datatruckRepositoryName,
} from "../../repositories/DatatruckRepository";
import type {
  GitPackageRepositoryConfig,
  GitRepositoryConfig,
  gitRepositoryName,
} from "../../repositories/GitRepository";
import type {
  ResticPackageRepositoryConfig,
  ResticRepositoryConfig,
  resticRepositoryName,
} from "../../repositories/ResticRepository";

export type PackageRepositoryConfig = {
  names?: string[];
} & (
  | {
      type: typeof resticRepositoryName;
      config: ResticPackageRepositoryConfig;
    }
  | {
      type: typeof datatruckRepositoryName;
      config: DatatruckPackageRepositoryConfig;
    }
  | {
      type: typeof gitRepositoryName;
      config: GitPackageRepositoryConfig;
    }
);

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

export type RepositoryConfigEnabledAction =
  | "backup"
  | "init"
  | "prune"
  | "restore"
  | "snapshots";

export type RepositoryEnabledObject = {
  [K in "defaults" | RepositoryConfigEnabledAction]?: boolean;
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
