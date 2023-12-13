import { PreSnapshot } from "../repositories/RepositoryAbstract";
import type { PackageConfig } from "../utils/datatruck/config-type";
import { ProcessEnv } from "../utils/process";
import { SpawnStep, runSpawnSteps } from "../utils/spawnSteps";
import { mkTmpDir } from "../utils/temp";
import {
  TaskBackupData,
  TaskPrepareRestoreData,
  TaskRestoreData,
  TaskAbstract,
} from "./TaskAbstract";

type NodeData = {
  dtt: {
    snapshot: PreSnapshot;
    package: PackageConfig;
    snapshotPath: string;
  };
};

export type ScriptTaskConfig = {
  env?: ProcessEnv;
  backupSteps: SpawnStep[];
  restoreSteps: SpawnStep[];
};

export function scriptTaskCode<Data extends Record<string, any>>(
  cb: (data: NodeData & Data) => void,
) {
  return `(${cb.toString()})(...arguments);`;
}

export const scriptTaskName = "script";

export class ScriptTask extends TaskAbstract<ScriptTaskConfig> {
  protected verbose?: boolean;
  override async backup(data: TaskBackupData) {
    const config = this.config;
    const snapshotPath =
      data.package.path ??
      (await mkTmpDir(scriptTaskName, "task", "backup", "snapshot"));

    await runSpawnSteps(config.backupSteps, {
      data: {
        dtt: {
          snapshot: data.snapshot,
          snapshotPath: snapshotPath,
          package: data.package,
        },
      },
      env: config.env,
      cwd: snapshotPath,
      verbose: data.options.verbose,
      tempDir: () => mkTmpDir(scriptTaskName, "task", "backup", "nodeStep"),
    });

    return { snapshotPath };
  }

  override async prepareRestore(data: TaskPrepareRestoreData) {
    return {
      snapshotPath:
        data.package.restorePath ??
        (await mkTmpDir(scriptTaskName, "task", "restore", "snapshot")),
    };
  }

  override async restore(data: TaskRestoreData) {
    const config = this.config;
    await runSpawnSteps(config.restoreSteps, {
      data: {
        dtt: {
          snapshot: data.snapshot,
          snapshotPath: data.snapshotPath,
          package: data.package,
        },
      },
      env: config.env,
      verbose: data.options.verbose,
      tempDir: () => mkTmpDir(scriptTaskName, "task", "restore", "nodeStep"),
    });
  }
}
