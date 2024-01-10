import type { PruneActionsOptions } from "../../actions/PruneAction";
import type { DataFormatType } from "../data-format";
import type { ReportStep } from "../reportSteps";
import type { SpawnStep } from "../spawnSteps";
import type {
  PackageRepositoryConfig,
  RepositoryConfigEnabledAction,
  RepositoryConfig,
} from "./config-repository-type";
import type { TaskConfig } from "./config-task-type";
import type { DatatruckCronServerOptions } from "./cron-server";
import type { DatatruckRepositoryServerOptions } from "./repository-server";

export { RepositoryConfig, RepositoryConfigEnabledAction, TaskConfig };

export type Config = {
  $schema?: string;
  hostname?: string;
  tempDir?: string;
  minFreeDiskSpace?: string | number;
  repositories: RepositoryConfig[];
  packages: PackageConfig[];
  server?: DatatruckServerOptions;
  reports?: DatatruckReportConfig[];
  prunePolicy?: DatatruckPolicyConfig;
};

export type DatatruckServerOptions = {
  log?: boolean;
  repository?: DatatruckRepositoryServerOptions;
  cron?: DatatruckCronServerOptions;
};

export type DatatruckReportConfig = {
  when?: "success" | "error";
  format?: Exclude<DataFormatType, "custom" | "tpl">;
  run: SpawnStep | ReportStep;
};

export type DatatruckPolicyConfig = Pick<
  PruneActionsOptions,
  | "keepDaily"
  | "keepHourly"
  | "keepMinutely"
  | "keepLast"
  | "keepMonthly"
  | "keepWeekly"
  | "keepYearly"
  | "groupBy"
  | "tags"
>;

export type PackageConfigMeta = {
  [name: string]: any;
};

export type PackageConfig = {
  name: string;
  enabled?: boolean;
  task?: TaskConfig;
  path?: string;
  restorePath?: string;
  meta?: PackageConfigMeta;
  restorePermissions?: {
    uid: string | number;
    gid: string | number;
  };
  include?: (string | SpawnStep)[];
  exclude?: (string | SpawnStep)[];
  repositoryNames?: string[];
  prunePolicy?: DatatruckPolicyConfig;
  repositoryConfigs?: PackageRepositoryConfig[];
};
