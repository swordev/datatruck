import {
  createTar,
  listTar,
  extractTar,
  checkPigzLib,
  CompressOptions,
  getTarVendor,
} from "../../src/utils/tar";
import { mkTmpDir } from "../../src/utils/temp";
import { createFileChanger } from "../util";
import { chmod, chown, rm, stat, writeFile } from "fs/promises";
import { platform } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

async function createIncludeList(include: string[]) {
  const includeDirPath = await mkTmpDir("test");
  const includeList = join(includeDirPath, "files.txt");

  const vendor = await getTarVendor();
  await writeFile(
    includeList,
    [...(vendor === "bsdtar" ? [] : ["notfound"]), ...include].join("\n"),
  );
  return { include, includeList };
}

describe("tar", async () => {
  const cases: {
    description: string;
    compress: CompressOptions | false;
  }[] = [
    {
      description: "without compressing",
      compress: false,
    },
    {
      description: "compressing using 1 core",
      compress: { cores: 1 },
    },
  ];

  if (await checkPigzLib())
    cases.push({
      description: "compress using all cores",
      compress: { cores: { percent: 100 } },
    });

  it.each(cases)(
    "pack, list and unpack ($description)",
    async ({ compress }) => {
      const { path, update } = await createFileChanger();
      const tarPath = join(path, "output.tar.gz");
      const outPath = join(path, "output");
      const verbose = false;

      await update({
        source: {
          emptyFolder: {},
          folder1: {
            file1: "f1",
            file2: "f2",
          },
          folder2: {
            file3: "f3",
          },
        },
      });
      try {
        await rm(outPath, { recursive: true });
      } catch {}

      // Compress

      const createProgress: { path: string }[] = [];

      const { include, includeList } = await createIncludeList([
        "emptyFolder",
        "folder1/file1",
        "folder1/file2",
        "folder2/file3",
      ]);

      await createTar({
        path: join(path, "source"),
        compress,
        verbose,
        includeList,
        output: tarPath,
        onEntry(data) {
          if (data.path) createProgress.push({ path: data.path });
        },
      });

      expect(createProgress.length).toBe(include.length);

      // List

      for (const path of include)
        expect(createProgress.some((o) => o.path === path)).toBeTruthy();

      const listProgress: { path: string }[] = [];
      const listResult = await listTar({
        input: tarPath,
        verbose,
        onEntry(data) {
          listProgress.push(data);
        },
      });

      expect(listResult).toBe(include.length);

      for (const path of include)
        expect(listProgress.some((o) => o.path === path)).toBeTruthy();

      // Extract

      const extractEntries: { path: string }[] = [];
      await extractTar({
        input: tarPath,
        decompress: compress,
        verbose,
        output: outPath,
        onEntry(data) {
          extractEntries.push({ path: data.path });
        },
      });
      for (const path of include)
        expect(extractEntries.some((o) => o.path === path)).toBeTruthy();
    },
  );
});

describe("createTar", () => {
  it("ignores recursive files and applies permissions to folders", async () => {
    const { path, update } = await createFileChanger();
    const { include, includeList } = await createIncludeList([
      "data",
      "data/file2",
    ]);
    const output = join(path, "output.tar.gz");
    await update({
      data: {
        file1: "1",
        file2: "2",
      },
    });

    const dataPath = join(path, "data");
    const listPaths: string[] = [];

    await chmod(dataPath, 0o777);
    await chown(dataPath, 2000, 2000);
    await createTar({ path, includeList, output });
    await listTar({ input: output, onEntry: (e) => listPaths.push(e.path) });
    await extractTar({ input: output, output: join(path, "output") });

    expect(include.join(",")).toBe(listPaths.join(","));

    const stats = await stat(join(path, "output/data"));

    if (platform() !== "win32") {
      expect(stats.uid).toBe(2000);
      expect(stats.gid).toBe(2000);
      expect(stats.mode & 0o7777).toBe(0o777);
    }
  });
});
