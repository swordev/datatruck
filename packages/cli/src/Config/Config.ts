import { DataFormatType } from "../utils/DataFormat";
import { DatatruckCronServerOptions } from "../utils/datatruck/cron-server";
import { DatatruckRepositoryServerOptions } from "../utils/datatruck/repository-server";
import { Step } from "../utils/steps";
import { PackageConfig } from "./PackageConfig";
import { PrunePolicyConfig } from "./PrunePolicyConfig";
import { RepositoryConfig } from "./RepositoryConfig";

export type Config = {
  $schema?: string;
  tempDir?: string;
  minFreeDiskSpace?: string | number;
  repositories: RepositoryConfig[];
  packages: PackageConfig[];
  server?: DatatruckServerOptions;
  reports?: ReportConfig[];
  prunePolicy?: PrunePolicyConfig;
};

export type DatatruckServerOptions = {
  log?: boolean;
  repository?: DatatruckRepositoryServerOptions;
  cron?: DatatruckCronServerOptions;
};

export type ReportConfig = {
  when?: "success" | "error";
  format?: Exclude<DataFormatType, "custom" | "tpl">;
  run: Step;
};
