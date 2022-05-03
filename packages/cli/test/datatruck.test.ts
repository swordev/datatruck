import { RepositoryConfigTypeType } from "../src/Config/RepositoryConfig";
import { makeParseLog, CommandEnum, exec } from "../src/Factory/CommandFactory";
import { parentTmpDir } from "../src/util/fs-util";
import {
  alterJsonSource,
  makeConfig,
  makeJsonSource,
  makeRepositoryConfig,
} from "./util";
import { readJSON } from "fs-extra";
import { readdir, rm } from "fs/promises";

jest.setTimeout(60000);

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
    const sourcePath = await makeJsonSource({ id: 1 });
    const configPath = await makeConfig({
      repositories: [await makeRepositoryConfig(type)],
      packages: [
        {
          name: "main/files",
          path: sourcePath,
          repositoryNames: [type],
          restorePath: `${sourcePath}-restore-{snapshotId}`,
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

    const parseSnapshotsLog1 = makeParseLog(CommandEnum.snapshots);

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

    expect(parseSnapshotsLog1()).toMatchObject([]);

    expect(
      await exec(
        CommandEnum.backup,
        {
          config: configPath,
          verbose: 1,
        },
        {}
      )
    ).toBe(0);

    const parseSnapshotsLog2 = makeParseLog(CommandEnum.snapshots);

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

    const snapshots2 = parseSnapshotsLog2();

    expect(snapshots2.length).toBe(1);
    expect(snapshots2[0].id.length).toBe(40);
    expect(snapshots2[0].packageName).toBe("main/files");

    expect(
      await exec(
        CommandEnum.backup,
        {
          config: configPath,
          verbose: 1,
        },
        {}
      )
    ).toBe(0);

    const endConsoleLog3 = makeParseLog(CommandEnum.snapshots);

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

    const snapshots3 = endConsoleLog3();

    expect(snapshots3.length).toBe(2);

    await alterJsonSource(sourcePath, { id: 2 });

    expect(
      await exec(
        CommandEnum.backup,
        {
          config: configPath,
          verbose: 1,
        },
        {}
      )
    ).toBe(0);

    const endConsoleLog4 = makeParseLog(CommandEnum.snapshots);

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

    const snapshots4 = endConsoleLog4();

    expect(snapshots4.length).toBe(3);
    const [lastSnapshot] = snapshots4;

    expect(
      await exec(
        CommandEnum.restore,
        {
          config: configPath,
          outputFormat: "json",
          verbose: 1,
        },
        {
          id: lastSnapshot.id,
        }
      )
    ).toBe(0);

    const restorePath = `${sourcePath}-restore-${lastSnapshot.id}`;
    expect(await readdir(restorePath)).toMatchObject(["file1.json"]);
    expect(await readJSON(`${restorePath}/file1.json`)).toMatchObject({
      id: 2,
    });

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

    const endConsoleLog5 = makeParseLog(CommandEnum.snapshots);

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

    const snapshots5 = endConsoleLog5();

    expect(snapshots5.length).toBe(1);
    expect(snapshots5[0].id).toBe(snapshots4[0].id);
  });

  it.each(repositoryTypes)("prune policy config %p", async (type) => {
    const sourcePath = await makeJsonSource({ id: 1 });
    const configPath = await makeConfig({
      repositories: [await makeRepositoryConfig(type)],
      packages: [
        {
          name: "main/files",
          path: sourcePath,
          repositoryNames: [type],
          prunePolicy: {
            keepLast: 2,
          },
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

    for (let x = 1; x <= 3; ++x)
      expect(
        await exec(
          CommandEnum.backup,
          {
            config: configPath,
            verbose: 1,
          },
          {}
        )
      ).toBe(0);

    if (type === "git") return;

    expect(
      await exec(
        CommandEnum.prune,
        {
          config: configPath,
          outputFormat: "json",
          verbose: 1,
        },
        { showAll: true, confirm: true }
      )
    ).toBe(0);

    const parseSnapshotsLog1 = makeParseLog(CommandEnum.snapshots);

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

    expect(parseSnapshotsLog1().length).toBe(2);
  });
});
