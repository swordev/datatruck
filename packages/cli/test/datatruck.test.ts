import { RepositoryConfigTypeType } from "../src/Config/RepositoryConfig";
import { makeParseLog, CommandEnum, exec } from "../src/Factory/CommandFactory";
import { parentTmpDir } from "../src/util/fs-util";
import { expectSuccessBackup, expectSuccessRestore } from "./expect";
import {
  makeConfig,
  makeRepositoryConfig,
  createFileChanger,
  FileChanges,
} from "./util";
import { rm } from "fs/promises";

jest.setTimeout(120_000);

const repositoryTypes = [
  "local",
  "git",
  "restic",
] as RepositoryConfigTypeType[];

afterAll(async () => {
  await rm(parentTmpDir(), {
    recursive: true,
  });
});

describe("datatruck", () => {
  it("returns config", async () => {
    const configPath = await makeConfig({
      repositories: [
        {
          name: "git",
          type: "git",
          config: {
            repo: "/",
          },
        },
        {
          name: "local",
          type: "local",
          config: {
            outPath: "/",
          },
        },
      ],
      packages: [
        {
          name: "main/files",
          path: "/source",
          repositoryNames: ["local"],
          include: [
            "path1",
            {
              type: "spawn",
              command: "echo",
              args: [],
            },
          ],
        },
      ],
    });

    const parseConfigLog = makeParseLog(CommandEnum.config);

    expect(
      await exec(
        CommandEnum.config,
        {
          config: configPath,
          outputFormat: "json",
          verbose: 1,
        },
        {}
      )
    ).toBe(0);

    expect(parseConfigLog()).toMatchObject([
      {
        package: "main/files",
        repositoryNames: ["local"],
      },
    ] as ReturnType<typeof parseConfigLog>);
  });

  it.each(repositoryTypes)(`init %p`, async (type) => {
    const configPath = await makeConfig({
      repositories: [await makeRepositoryConfig(type)],
      packages: [],
    });

    const parseConfigLog = makeParseLog(CommandEnum.init);

    expect(
      await exec(
        CommandEnum.init,
        {
          config: configPath,
          outputFormat: "json",
          verbose: 1,
        },
        {}
      )
    ).toBe(0);

    expect(parseConfigLog()).toMatchObject([
      {
        error: null,
        repositoryName: type,
        repositoryType: type,
      },
    ] as ReturnType<typeof parseConfigLog>);
  });

  it.each(repositoryTypes)("backup, restore, prune %p", async (type) => {
    const fileChanges: FileChanges[] = [
      {
        "file1.json": JSON.stringify({ id: 2 }),
      },
    ];

    const fileChanger = await createFileChanger();
    const configPath = await makeConfig({
      repositories: [await makeRepositoryConfig(type)],
      packages: [
        {
          name: "main/files",
          path: fileChanger.path,
          repositoryNames: [type],
          restorePath: `${fileChanger.path}-restore-{snapshotId}`,
        },
      ],
    });

    expect(
      await exec(
        CommandEnum.init,
        {
          config: configPath,
          verbose: 1,
        },
        {}
      )
    ).toBe(0);

    await fileChanger.update({
      "file1.json": JSON.stringify({ id: 1 }),
    });

    const backupResults: Awaited<ReturnType<typeof expectSuccessBackup>>[] = [];

    let backupIndex = 0;
    for (const changes of fileChanges) {
      backupResults.push(
        await expectSuccessBackup({
          configPath,
          fileChanger,
          changes,
          backupIndex: ++backupIndex,
        })
      );
    }

    let restoreIndex = 0;
    for (const backupResult of backupResults) {
      await expectSuccessRestore({
        configPath,
        fileChanger,
        restoreIndex: restoreIndex++,
        snapshotId: backupResult.snapshotId,
        files: backupResult.files,
      });
    }

    if (type === "git") return;
    expect(
      await exec(
        CommandEnum.prune,
        {
          config: configPath,
          outputFormat: "json",
          verbose: 1,
        },
        {
          keepLast: 1,
          confirm: true,
        }
      )
    ).toBe(0);

    const parseSnapshotsLog = makeParseLog(CommandEnum.snapshots);

    expect(
      await exec(
        CommandEnum.snapshots,
        {
          config: configPath,
          outputFormat: "json",
          verbose: 1,
        },
        {}
      )
    ).toBe(0);

    const snapshots = parseSnapshotsLog();
    const lastBackup = backupResults[backupResults.length - 1];
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].id).toBe(lastBackup.snapshotId);
  });
});
