import { SpawnStep } from "../utils/spawnSteps";
import { PackageRepositoryConfig } from "./PackageRepositoryConfig";
import { PrunePolicyConfig } from "./PrunePolicyConfig";
import type { TaskConfig } from "./TaskConfig";

export type Meta = {
  [name: string]: any;
};

export type PackageConfig = {
  name: string;
  enabled?: boolean;
  task?: TaskConfig;
  path?: string;
  restorePath?: string;
  meta?: Meta;
  restorePermissions?: {
    uid: string | number;
    gid: string | number;
  };
  include?: (string | SpawnStep)[];
  exclude?: (string | SpawnStep)[];
  repositoryNames?: string[];
  prunePolicy?: PrunePolicyConfig;
  repositoryConfigs?: PackageRepositoryConfig[];
};
