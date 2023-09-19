import { createTar, listTar, extractTar } from "../../src/utils/tar";
import { createFileChanger } from "../util";
import { rm } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("tar", () => {
  it("pack, list and unpack", async () => {
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
    await createTar({
      path: join(path, "source"),
      compress: true,
      verbose,
      include,
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
      verbose,
      output: outPath,
      onEntry(data) {
        extractEntries.push({ path: data.path });
      },
    });
    for (const path of include)
      expect(extractEntries.some((o) => o.path === path)).toBeTruthy();
  });
});
