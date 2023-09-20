import { mkTmpDir, tmpDir } from "../../src/utils/fs";
import {
  createTar,
  listTar,
  extractTar,
  checkPigzLib,
  CompressOptions,
} from "../../src/utils/tar";
import { createFileChanger } from "../util";
import { rm, writeFile } from "fs/promises";
import { cpus } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

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
      const include = [
        "emptyFolder/",
        "folder1/file1",
        "folder1/file2",
        "folder2/file3",
      ];

      const includeDirPath = await mkTmpDir("test");
      const includeList = join(includeDirPath, "files.txt");

      await writeFile(includeList, ["notfound", ...include].join("\n"));

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
