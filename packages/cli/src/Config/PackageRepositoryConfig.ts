import {
  DatatruckPackageRepositoryConfig,
  datatruckRepositoryName,
} from "../repositories/DatatruckRepository";
import {
  GitPackageRepositoryConfig,
  gitRepositoryName,
} from "../repositories/GitRepository";
import {
  ResticPackageRepositoryConfig,
  resticRepositoryName,
} from "../repositories/ResticRepository";

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
