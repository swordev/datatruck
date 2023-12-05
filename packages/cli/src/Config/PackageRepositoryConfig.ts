import {
  DatatruckPackageRepositoryConfig,
  datatruckRepositoryName,
} from "../Repository/DatatruckRepository";
import {
  GitPackageRepositoryConfig,
  gitRepositoryName,
} from "../Repository/GitRepository";
import {
  ResticPackageRepositoryConfig,
  resticRepositoryName,
} from "../Repository/ResticRepository";

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
