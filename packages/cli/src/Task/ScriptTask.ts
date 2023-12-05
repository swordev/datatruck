import { PackageConfig } from "../Config/PackageConfig";
import { PreSnapshot } from "../Repository/RepositoryAbstract";
import { ProcessEnv } from "../utils/process";
import { Step, runSteps } from "../utils/steps";
import { mkTmpDir } from "../utils/temp";
import {
  TaskBackupData,
  TaskPrepareRestoreData,
  TaskRestoreData,
  TaskAbstract,
} from "./TaskAbstract";

type NodeVars = {
  dtt: {
    snapshot: PreSnapshot;
    package: PackageConfig;
    snapshotPath: string;
  };
};

export type ScriptTaskConfig = {
  env?: ProcessEnv;
  backupSteps: Step[];
  restoreSteps: Step[];
};

export function scriptTaskCode<V extends Record<string, any>>(
  cb: (vars: NodeVars & V) => void,
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

    await runSteps(config.backupSteps, {
      env: config.env,
      vars: {
        dtt: {
          snapshot: data.snapshot,
          snapshotPath: snapshotPath,
          package: data.package,
        },
      },
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
    await runSteps(config.restoreSteps, {
      env: config.env,
      vars: {
        dtt: {
          snapshot: data.snapshot,
          snapshotPath: data.snapshotPath,
          package: data.package,
        },
      },
      verbose: data.options.verbose,
      tempDir: () => mkTmpDir(scriptTaskName, "task", "restore", "nodeStep"),
    });
  }
}
