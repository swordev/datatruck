import { RepositoryConfigTypeType } from "../src/Config/RepositoryConfig";
import { createActionInterface } from "../src/Factory/CommandFactory";
import { parseStringList } from "../src/utils/string";
import { runBackups, runRestores } from "./expect";
import { fileChanges } from "./fileChanges";
import {
  makeConfig,
  makeRepositoryConfig,
  createFileChanger,
  FileChanges,
} from "./util";
import { writeFile } from "fs/promises";
import { describe, expect, it } from "vitest";

const repositoryTypes = parseStringList<RepositoryConfigTypeType>(
  process.env.DTT_REPO,
  ["datatruck", "git", "restic"],
  true,
);

describe(
  "datatruck",
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
              outPath: "/",
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

      const dtt = createActionInterface({ config });

      expect(await dtt.config({})).toMatchObject([
        {
          packageName: "main/files",
          repositoryNames: ["datatruck"],
        },
      ]);
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
      const dtt = createActionInterface({ config });
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

    it.each(repositoryTypes)(`init %s`, async (type) => {
      const config = await makeConfig({
        repositories: [await makeRepositoryConfig(type)],
        packages: [],
      });
      const dtt = createActionInterface({ config });
      expect(await dtt.init({})).toMatchObject([
        {
          error: null,
          repositoryName: type,
          repositoryType: type,
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

      const dtt = createActionInterface({ config });
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

        const dtt = createActionInterface({ config });
        await dtt.init({});

        const backups = await runBackups(
          config,
          fileChanger,
          fileChanges(type),
        );

        await runRestores(config, fileChanger, backups);
        await runRestores(config, fileChanger, backups, `${type}-mirror`);
      },
    );

    it.each(repositoryTypes)("snapshots of %s", async (type) => {
      const fileChanger = await createFileChanger();
      const config = await makeConfig({
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

      const dtt = createActionInterface({ config });
      await dtt.init({});
      await runBackups(config, fileChanger, [changes]);

      const snapshots = await dtt.snapshots({});
      const [snapshot] = snapshots;
      expect(snapshots).toHaveLength(1);
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
  },
);
