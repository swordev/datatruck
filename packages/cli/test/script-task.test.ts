import { createActionInterface } from "../src/Factory/CommandFactory";
import { mkTmpDir } from "../src/utils/fs";
import { parseStringList } from "../src/utils/string";
import { makeConfig, makeRepositoryConfig, testRepositoryTypes } from "./util";
import { readFile, readdir, writeFile } from "fs/promises";
import { describe, expect, it } from "vitest";

const verbose = 1;
const repositoryTypes = parseStringList(
  process.env.DTT_REPO,
  testRepositoryTypes,
  true,
);

describe(
  "script-task",
  () => {
    it.each(repositoryTypes.map((repositoryType) => ({ repositoryType })))(
      "with temp path $repositoryType",
      async ({ repositoryType }) => {
        const storePath = await mkTmpDir("test_script-task_store");
        const config = await makeConfig({
          repositories: [await makeRepositoryConfig(repositoryType)],
          packages: [
            {
              name: "script-task/test1",
              repositoryNames: [repositoryType],
              task: {
                name: "script",
                config: {
                  backupSteps: [
                    {
                      type: "node",
                      config: {
                        code: "require('fs').writeFileSync(dtt.targetPath + '/file.txt', 'test');",
                      },
                    },
                  ],
                  restoreSteps: [
                    {
                      type: "node",
                      config: {
                        vars: {
                          storePath,
                        },
                        code: `require("fs").cpSync(dtt.targetPath + "/file.txt", storePath + "/file.txt");`,
                      },
                    },
                  ],
                },
              },
            },
          ],
        });

        const dtt = createActionInterface({ config, verbose });
        await dtt.init({});
        await dtt.backup({});
        const [snapshot] = await dtt.snapshots({ last: "1" });
        await dtt.restore({ id: snapshot.id });
        const fileContents = (
          await readFile(storePath + "/file.txt")
        ).toString();
        expect(fileContents).toBe("test");
      },
    );

    it.each(repositoryTypes.map((repositoryType) => ({ repositoryType })))(
      "with backup path $repositoryType",
      async ({ repositoryType }) => {
        const backupPath = await mkTmpDir("test_script-task_backup");
        const restorePath = await mkTmpDir("test_script-task_restore");
        await writeFile(`${backupPath}/file1.txt`, "test1");
        const config = await makeConfig({
          repositories: [await makeRepositoryConfig(repositoryType)],
          packages: [
            {
              name: "script-task/test2",
              path: backupPath,
              restorePath: restorePath,
              repositoryNames: [repositoryType],
              task: {
                name: "script",
                config: {
                  backupSteps: [
                    {
                      type: "node",
                      config: {
                        vars: {
                          backupPath,
                        },
                        code: [
                          "require('assert').strict.equal(dtt.targetPath, backupPath)",
                          "require('assert').strict.equal(dtt.targetPath, dtt.package.path)",
                          "require('fs').writeFileSync(dtt.package.path + '/file2.txt', 'test2')",
                        ],
                      },
                    },
                  ],
                  restoreSteps: [
                    {
                      type: "node",
                      config: {
                        vars: {
                          restorePath,
                        },
                        code: [
                          "require('assert').strict.equal(dtt.targetPath, restorePath)",
                          "require('assert').strict.equal(dtt.targetPath, dtt.package.restorePath)",
                          "require('fs').writeFileSync(dtt.package.restorePath + '/file3.txt', 'test3')",
                        ],
                      },
                    },
                  ],
                },
              },
            },
          ],
        });

        const dtt = createActionInterface({ config, verbose });
        await dtt.init({});
        await dtt.backup({});
        const [snapshot] = await dtt.snapshots({ last: "1" });
        await dtt.restore({ id: snapshot.id });

        expect(await readdir(restorePath)).toHaveLength(3);
        for (let index = 1; index <= 3; ++index) {
          const file = (
            await readFile(`${restorePath}/file${index}.txt`)
          ).toString();
          expect(file).toBe("test" + index);
        }
      },
    );
  },
  {
    timeout: 300_000,
  },
);
