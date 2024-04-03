import { scriptTaskCode } from "../src/tasks/ScriptTask";
import { createCommands } from "../src/utils/datatruck/command";
import { parseStringList } from "../src/utils/string";
import { mkTmpDir } from "../src/utils/temp";
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
  {
    timeout: 300_000,
  },
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
                        code: scriptTaskCode(({ dtt }) => {
                          require("fs").writeFileSync(
                            dtt.snapshotPath + "/file.txt",
                            "test",
                          );
                        }),
                      },
                    },
                  ],
                  restoreSteps: [
                    {
                      type: "node",
                      config: {
                        data: {
                          storePath,
                        },
                        code: scriptTaskCode<{ storePath: string }>(
                          ({ dtt, storePath }) => {
                            require("fs").cpSync(
                              dtt.snapshotPath + "/file.txt",
                              storePath + "/file.txt",
                            );
                          },
                        ),
                      },
                    },
                  ],
                },
              },
            },
          ],
        });

        const dtt = createCommands({ config, verbose });
        await dtt.init({});
        await dtt.backup({});
        const [snapshot] = await dtt.snapshots({ last: 1 });
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
                        data: {
                          backupPath,
                        },
                        code: scriptTaskCode<{ backupPath: string }>(
                          ({ dtt, backupPath }) => {
                            const { strict } = require("assert");
                            const { writeFileSync } = require("fs");
                            strict.equal(dtt.snapshotPath, backupPath);
                            strict.equal(dtt.snapshotPath, dtt.package.path);
                            writeFileSync(
                              dtt.package.path + "/file2.txt",
                              "test2",
                            );
                          },
                        ),
                      },
                    },
                  ],
                  restoreSteps: [
                    {
                      type: "node",
                      config: {
                        data: {
                          restorePath,
                        },
                        code: scriptTaskCode<{ restorePath: string }>(
                          ({ dtt, restorePath }) => {
                            const { strict } = require("assert");
                            const { writeFileSync } = require("fs");
                            strict.equal(dtt.snapshotPath, restorePath);
                            strict.equal(
                              dtt.snapshotPath,
                              dtt.package.restorePath,
                            );
                            writeFileSync(
                              dtt.package.restorePath + "/file3.txt",
                              "test3",
                            );
                          },
                        ),
                      },
                    },
                  ],
                },
              },
            },
          ],
        });

        const dtt = createCommands({ config, verbose });
        await dtt.init({});
        await dtt.backup({});
        const [snapshot] = await dtt.snapshots({ last: 1 });
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
);
