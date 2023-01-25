import { RestoreCommandOptionsType } from "../src/Command/RestoreCommand";
import { CommandEnum, exec, makeParseLog } from "../src/Factory/CommandFactory";
import "./toEqualMessage";
import {
  expectSameFiles,
  FileChangerResult,
  FileChanges,
  FileMap,
  readFiles,
} from "./util";
import { rm } from "fs/promises";
import { expect } from "vitest";

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
  files: FileMap;
  restoreIndex: number;
  restoreOptions: RestoreCommandOptionsType;
  cleanRestorePath?: boolean;
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
      data.restoreOptions
    )
  ).toEqualMessage(0, messageError);

  const restorePath = `${data.fileChanger.path}-restore-${data.restoreOptions.id}`;
  const restoreFiles = await readFiles(restorePath);

  await expectSameFiles(data.files, restoreFiles, messageError);

  if (data.cleanRestorePath)
    await rm(restorePath, {
      recursive: true,
    });
}
