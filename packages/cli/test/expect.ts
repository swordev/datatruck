import { RestoreCommandOptions } from "../src/commands/RestoreCommand";
import { createCommands } from "../src/utils/datatruck/command";
import "./toEqualMessage";
import {
  FileChangerResult,
  FileChanges,
  FileMap,
  expectSameFiles,
  readFiles,
} from "./util";
import { rm } from "fs/promises";

type Backup = { id: string; files: FileMap };

export async function runBackups(
  config: string,
  fileChanger: FileChangerResult,
  changes: FileChanges[],
) {
  const backups: Backup[] = [];
  const dtt = createCommands({ config });
  let index = 0;
  for (const change of changes) {
    const files = await fileChanger.update(change);
    try {
      console.log(`Running backup ${index + 1}/${backups.length}`);
      await dtt.backup({});
    } catch (error) {
      throw new Error(`Failed backup: ${index}`);
    }
    index++;
    const [snapshot] = await dtt.snapshots({ last: 1 });
    backups.push({ id: snapshot.id, files });
  }
  return backups;
}

export async function runRestores(
  config: string,
  fileChanger: FileChangerResult,
  backups: Backup[],
  options?: Omit<RestoreCommandOptions, "id">,
) {
  const dtt = createCommands({ config });
  let index = 0;
  for (const { id, files } of backups) {
    console.log(`Running restore ${index + 1}/${backups.length}`);
    await dtt.restore({ id, ...options });
    const initial = options?.initial;
    const restorePath = initial
      ? fileChanger.path
      : `${fileChanger.path}-restore-${id}`;

    const restoreFiles = await readFiles(restorePath);
    await expectSameFiles(files, restoreFiles, `Invalid restore (${index})`);
    if (!process.env.DEBUG && !initial)
      await rm(restorePath, { recursive: true });
    index++;
  }
}
