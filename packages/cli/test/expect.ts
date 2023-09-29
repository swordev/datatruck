import { createActionInterface } from "../src/Factory/CommandFactory";
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
  const dtt = createActionInterface({ config });
  let index = 0;
  for (const change of changes) {
    const files = await fileChanger.update(change);
    try {
      await dtt.backup({});
    } catch (error) {
      throw new Error(`Failed backup: ${index}`);
    }
    index++;
    const [snapshot] = await dtt.snapshots({ last: "1" });
    backups.push({ id: snapshot.id, files });
  }
  return backups;
}

export async function runRestores(
  config: string,
  fileChanger: FileChangerResult,
  backups: Backup[],
  repository?: string,
) {
  const dtt = createActionInterface({ config });
  let index = 0;
  for (const { id, files } of backups) {
    await dtt.restore({ id, repository });
    const restorePath = `${fileChanger.path}-restore-${id}`;
    const restoreFiles = await readFiles(restorePath);
    await expectSameFiles(files, restoreFiles, `Invalid snapshot (${index})`);
    if (!process.env.DEBUG) await rm(restorePath, { recursive: true });
    index++;
  }
}
