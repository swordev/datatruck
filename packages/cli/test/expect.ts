import { CommandEnum, exec, makeParseLog } from "../src/Factory/CommandFactory";
import "./toEqualMessage";
import {
  expectSameFiles,
  FileChangerResult,
  FileChanges,
  FileMap,
  readFiles,
} from "./util";

export async function expectSuccessBackup(data: {
  configPath: string;
  fileChanger: FileChangerResult;
  changes: FileChanges;
  backupIndex: number;
}) {
  const messageError = `Invalid backup (${data.backupIndex})`;
  const files = await data.fileChanger.update(data.changes);

  expect(
    await exec(
      CommandEnum.backup,
      {
        config: data.configPath,
        verbose: 1,
      },
      {}
    )
  ).toEqualMessage(0, messageError);

  const parseLog = makeParseLog(CommandEnum.snapshots);

  expect(
    await exec(
      CommandEnum.snapshots,
      {
        config: data.configPath,
        outputFormat: "json",
        verbose: 1,
      },
      {
        last: "1",
      }
    )
  ).toEqualMessage(0, messageError);

  const snapshot = parseLog()[0];

  return { snapshotId: snapshot.id, files };
}

export async function expectSuccessRestore(data: {
  configPath: string;
  fileChanger: FileChangerResult;
  snapshotId: string;
  files: FileMap;
  restoreIndex: number;
}) {
  const messageError = `Invalid snapshot (${data.restoreIndex})`;
  expect(
    await exec(
      CommandEnum.restore,
      {
        config: data.configPath,
        outputFormat: "json",
        verbose: 1,
      },
      {
        id: data.snapshotId,
      }
    )
  ).toEqualMessage(0, messageError);

  const restorePath = `${data.fileChanger.path}-restore-${data.snapshotId}`;
  const restoreFiles = await readFiles(restorePath);

  await expectSameFiles(data.files, restoreFiles, messageError);
}
