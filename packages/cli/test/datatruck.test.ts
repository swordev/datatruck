import { DatatruckRepository } from "../src/repositories/DatatruckRepository";
import { createCommands } from "../src/utils/datatruck/command";
import { existsFile, readTextFile } from "../src/utils/fs";
import { parseStringList } from "../src/utils/string";
import { mkTmpDir } from "../src/utils/temp";
import { runBackups, runRestores } from "./expect";
import { fileChanges } from "./fileChanges";
import {
  makeConfig,
  makeRepositoryConfig,
  createFileChanger,
  FileChanges,
  testRepositoryTypes,
  expectSameFiles,
  readFiles,
} from "./util";
import { readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryTypes = parseStringList(
  process.env.DTT_REPO,
  testRepositoryTypes,
  true,
);

beforeAll(() => {
  process.env.DTT_BIN_SCRIPT = "packages/cli/lib/bin.js";
});

describe(
  "datatruck",
  {
    timeout: 300_000,
  },
  () => {
    it("returns config", async () => {
      const config = await makeConfig({
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
              backend: "/",
            },
          },
        ],
        packages: [
          {
            name: "main/files",
            path: "/source",
            repositoryNames: ["datatruck"],
            include: ["path1"],
          },
        ],
      });

      const dtt = createCommands({ config });
      const config2 = await dtt.config({});

      expect(config2.data.packages[0].name).toBe("main/files");
      expect(config2.data.packages[0].repositoryNames).toEqual(["datatruck"]);
    });

    it("backups paths generated on fly", async () => {
      const fileChanger = await createFileChanger();
      const config = await makeConfig({
        repositories: [await makeRepositoryConfig("datatruck")],
        packages: [
          {
            name: "main",
            path: fileChanger.path,
            restorePath: `${fileChanger.path}-restore-{snapshotId}`,
            include: [
              "file0",
              {
                type: "node",
                config: {
                  code: ['console.log("file1");', 'console.log("file2");'],
                },
              },
              {
                type: "node",
                config: {
                  code: 'console.log("file3");',
                },
              },
            ],
          },
        ],
      });
      const dtt = createCommands({ config });
      await dtt.init({});
      await writeFile(`${fileChanger.path}/file4`, "f4");
      const backupFiles = await runBackups(config, fileChanger, [
        {
          file0: "f0",
          file1: "f1",
          file2: "f2",
          file3: "f3",
        },
      ]);
      await runRestores(config, fileChanger, backupFiles);
    });

    it("disables restore path", async () => {
      const fileChanger = await createFileChanger();
      const config = await makeConfig({
        repositories: [await makeRepositoryConfig("datatruck")],
        packages: [
          {
            name: "main",
            path: fileChanger.path,
            restorePath: `${fileChanger.path}-restore-{snapshotId}`,
          },
        ],
      });
      const dtt = createCommands({ config });
      await dtt.init({});
      const backupFiles = await runBackups(config, fileChanger, [
        {
          f1: "test",
        },
      ]);

      await runRestores(config, fileChanger, backupFiles);

      await expect(() =>
        runRestores(config, fileChanger, backupFiles, {
          initial: true,
        }),
      ).rejects.toThrowError();

      await rm(fileChanger.path, { recursive: true });

      const f1Path = join(fileChanger.path, "f1");
      expect(await existsFile(f1Path)).toBeFalsy();

      await runRestores(config, fileChanger, backupFiles, {
        initial: true,
      });
      expect(await existsFile(f1Path)).toBeTruthy();
      expect((await readFile(f1Path)).toString()).toBe("test");
    });

    it.each(repositoryTypes)(`saves one snapshot %s`, async (type) => {
      const fileChanger = await createFileChanger();
      const config = await makeConfig({
        repositories: [await makeRepositoryConfig(type)],
        packages: [
          {
            name: "main",
            path: fileChanger.path,
            restorePath: `${fileChanger.path}-restore-{snapshotId}`,
          },
        ],
      });
      const dtt = createCommands({ config });
      await fileChanger.update({ f: "test" });
      await dtt.init({});
      await dtt.backup({});
      const snapshots = await dtt.snapshots({});
      expect(snapshots).toHaveLength(1);
      await dtt.restore({ id: snapshots[0].id });
    });
    it.each(repositoryTypes)(`init %s`, async (type) => {
      const repo = await makeRepositoryConfig(type);
      const config = await makeConfig({
        repositories: [repo],
        packages: [],
      });
      const dtt = createCommands({ config });
      expect(await dtt.init({})).toMatchObject([
        {
          error: null,
          repositoryName: repo.name,
          repositoryType: repo.type,
        },
      ]);
    });

    it.each(repositoryTypes)("backup, restore, prune %s", async (type) => {
      const fileChanger = await createFileChanger();
      const config = await makeConfig({
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

      const dtt = createCommands({ config });
      await dtt.init({});

      const backups = await runBackups(config, fileChanger, fileChanges(type));

      await runRestores(config, fileChanger, backups);

      if (type !== "git") {
        await dtt.prune({ keepLast: 1, confirm: true });
        const snapshots = await dtt.snapshots({});
        const lastSnapshot = snapshots[snapshots.length - 1];
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].id).toBe(lastSnapshot.id);
      }
    });

    it.each(repositoryTypes)(
      "backup into %s mirror repository",
      async (type) => {
        if (type === "git") return expect(true).toBeTruthy();
        const fileChanger = await createFileChanger();
        const config = await makeConfig({
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

        const dtt = createCommands({ config });
        await dtt.init({});

        const backups = await runBackups(
          config,
          fileChanger,
          fileChanges(type),
        );

        await runRestores(config, fileChanger, backups);
        await runRestores(config, fileChanger, backups, {
          repositoryNames: [`${type}-mirror`],
        });
      },
    );

    it.each(repositoryTypes)("snapshots of %s", async (type) => {
      const repo = await makeRepositoryConfig(type);
      const fileChanger = await createFileChanger();
      const config = await makeConfig({
        repositories: [repo],
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

      const dtt = createCommands({ config });
      await dtt.init({});
      await runBackups(config, fileChanger, [changes]);

      const snapshots = await dtt.snapshots({});
      const [snapshot] = snapshots;
      expect(snapshots).toHaveLength(1);
      expect(snapshot.packageName).toBe("main/files");
      expect(snapshot.tags.join()).toBe("");
      expect(snapshot.shortId).toBe(snapshot.id.slice(0, 8));
      expect(snapshot.size).toBeGreaterThan(0);
      expect(snapshot.repositoryName).toBe(repo.name);
      expect(snapshot.repositoryType).toBe(repo.type);
    });

    it.each(repositoryTypes)("initial restore of %s", async (type) => {
      const repo = await makeRepositoryConfig(type);
      const fileChanger = await createFileChanger();
      const restorePath = await mkTmpDir("restorePath");
      const config = await makeConfig({
        repositories: [repo],
        packages: [
          {
            name: "main/files",
            path: fileChanger.path,
            restorePath,
            repositoryNames: [type],
          },
        ],
      });

      const restoredFile = `${restorePath}/file1`;
      const dtt = createCommands({ config });
      const [{ id }] = await runBackups(config, fileChanger, [
        { file1: "abc" },
      ]);

      await dtt.restore({ id });
      await expect(readTextFile(restoredFile)).resolves.toBe("abc");
      await expect(dtt.restore({ id, initial: true })).rejects.toThrowError();
      await rm(fileChanger.path, { recursive: true });
      await dtt.restore({ id, initial: true });
      await expect(readTextFile(restoredFile)).resolves.toBe("abc");
    });

    it.each(repositoryTypes)("runs job of %s", async (type) => {
      const repo = await makeRepositoryConfig(type);
      const fileChanger = await createFileChanger({
        file: "test",
      });
      const config = await makeConfig({
        repositories: [repo],
        jobs: {
          backup: {
            action: "backup",
            options: {
              packageNames: ["main/files"],
            },
          },
        },
        packages: [
          {
            name: "main/files",
            path: fileChanger.path,
            repositoryNames: [type],
          },
        ],
      });
      const dtt = createCommands({ config });
      await dtt.run({ jobName: "backup" });
      const snapshots = await dtt.snapshots({});
      expect(snapshots.length).toBe(1);
    });
    it.each(repositoryTypes)("exports of %s", async (type) => {
      const repo = await makeRepositoryConfig(type);
      const fileChanger = await createFileChanger({
        file: "test",
      });
      const config = await makeConfig({
        repositories: [repo],
        packages: [
          {
            name: "main/files",
            path: fileChanger.path,
            repositoryNames: [type],
          },
        ],
      });
      const dtt = createCommands({ config });
      await dtt.backup({});
      const snapshots = await dtt.snapshots({});
      expect(snapshots.length).toBe(1);
      const outPath = await mkTmpDir("test", "export");
      await dtt.export({ id: snapshots[0].id, outPath });
      const snapshotPath = join(
        outPath,
        type,
        DatatruckRepository.createSnapshotName(snapshots[0], {
          name: "main/files",
        }),
      );
      const files = await readFiles(snapshotPath);
      await expectSameFiles(fileChanger.files, files, "Invalid export export");
    });
  },
);
