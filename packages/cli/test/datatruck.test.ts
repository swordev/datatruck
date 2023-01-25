import { RepositoryConfigTypeType } from "../src/Config/RepositoryConfig";
import { makeParseLog, CommandEnum, exec } from "../src/Factory/CommandFactory";
import { parentTmpDir } from "../src/utils/fs";
import { expectSuccessBackup, expectSuccessRestore } from "./expect";
import {
  makeConfig,
  makeRepositoryConfig,
  createFileChanger,
  FileChanges,
} from "./util";
import { rm } from "fs/promises";
import { describe, expect, it, afterAll } from "vitest";

const repositoryTypes = (
  process.env.DTT_REPO
    ? process.env.DTT_REPO.split(",")
    : ["datatruck", "git", "restic"]
) as RepositoryConfigTypeType[];

const fileChanges: (type: RepositoryConfigTypeType) => FileChanges[] = (type) =>
  [
    {
      file1: "contents",
      // https://github.com/restic/restic/issues/3760
      ...(type === "restic" && {
        empty: "",
      }),
    },
    {},
    { file1: "contents2" },
    { file1: false },
    {
      folder1: {},
    },
    {
      folder1: {
        "file1.json": JSON.stringify({ hello: "world" }),
        folder2: {
          folder3: {
            folder4: {
              folder5: {
                folder6: {
                  ".file": "*",
                },
              },
            },
          },
        },
      },
    },
    {
      folder1: {
        folder2: {
          folder3: {
            ...Array.from({ length: 20 })
              .fill(0)
              .map((v, i) => `file_${i}`)
              .reduce((result, name) => {
                result[name] = `filename: ${name}`;
                return result;
              }, {} as Record<string, string>),
          },
        },
      },
    },
    {
      folder1: {
        "file.bin": Buffer.from([1, 2, 3, 4]),
      },
    },
  ] as FileChanges[];

afterAll(async () => {
  try {
    await rm(parentTmpDir(), {
      recursive: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
});

describe(
  "datatruck",
  () => {
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
            name: "datatruck",
            type: "datatruck",
            config: {
              outPath: "/",
            },
          },
        ],
        packages: [
          {
            name: "main/files",
            path: "/source",
            repositoryNames: ["datatruck"],
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
          packageName: "main/files",
          repositoryNames: ["datatruck"],
        },
      ] as ReturnType<typeof parseConfigLog>);
    });

    it.each(repositoryTypes)(`init %s`, async (type) => {
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

    it.each(repositoryTypes)("backup, restore, prune %s", async (type) => {
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

      const backupResults: Awaited<ReturnType<typeof expectSuccessBackup>>[] =
        [];

      let backupIndex = 0;
      for (const changes of fileChanges(type)) {
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
          files: backupResult.files,
          restoreOptions: {
            id: backupResult.snapshotId,
          },
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

    it.each(repositoryTypes)(
      "backup into %s mirror repository",
      async (type) => {
        if (type === "git") return expect(true).toBeTruthy();
        const fileChanger = await createFileChanger();
        const configPath = await makeConfig({
          repositories: [
            {
              ...(await makeRepositoryConfig(type)),
              mirrorRepoNames: [`${type}-mirror`],
            },
            await makeRepositoryConfig(type, `${type}-mirror`),
          ],
          packages: [
            {
              name: "main/files",
              path: fileChanger.path,
              repositoryNames: [type, `${type}-mirror`],
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

        const backupResults: Awaited<ReturnType<typeof expectSuccessBackup>>[] =
          [];

        let backupIndex = 0;
        for (const changes of fileChanges(type)) {
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
            files: backupResult.files,
            cleanRestorePath: true,
            restoreOptions: {
              id: backupResult.snapshotId,
              repository: type,
            },
          });
        }

        for (const backupResult of backupResults) {
          await expectSuccessRestore({
            configPath,
            fileChanger,
            restoreIndex: restoreIndex++,
            files: backupResult.files,
            restoreOptions: {
              id: backupResult.snapshotId,
              repository: `${type}-mirror`,
            },
          });
        }
      }
    );

    it.each(repositoryTypes)("snapshots", async (type) => {
      const fileChanger = await createFileChanger();
      const configPath = await makeConfig({
        repositories: [await makeRepositoryConfig(type)],
        packages: [
          {
            name: "main/files",
            path: fileChanger.path,
            repositoryNames: [type],
          },
        ],
      });

      const changes: FileChanges = {
        file1: "abc",
        folder: {
          file2: "xyz",
        },
      };

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

      await expectSuccessBackup({
        configPath,
        fileChanger,
        changes,
        backupIndex: 0,
      });

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
      const [snapshot] = snapshots;
      expect(snapshots.length).toBe(1);
      expect(snapshot.packageName).toBe("main/files");
      expect(snapshot.tags.join()).toBe("");
      expect(snapshot.shortId).toBe(snapshot.id.slice(0, 8));
      expect(snapshot.size > 0).toBeTruthy();
      expect(snapshot.repositoryName).toBe(type);
      expect(snapshot.repositoryType).toBe(type);
    });
  },
  {
    timeout: 300_000,
  }
);
