import {
  createWriteStreamPool,
  ensureFreeDiskSpace,
  ensureSingleFile,
  fetchDiskStats,
  groupFiles,
} from "../../src/utils/fs";
import {
  isTmpDir,
  mkTmpDir,
  rmTmpDir,
  sessionTmpDir,
  tmpDir,
} from "../../src/utils/temp";
import { randomBytes } from "crypto";
import { mkdir, readFile, rm, rmdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, normalize } from "path";
import { it } from "vitest";
import { describe, expect, test } from "vitest";

describe("isTmpDir", () => {
  test("returns false", () => {
    const dir = sessionTmpDir();
    expect(isTmpDir("a")).toBeFalsy();
    expect(isTmpDir(".")).toBeFalsy();
    expect(isTmpDir("/")).toBeFalsy();
    expect(isTmpDir("")).toBeFalsy();
    expect(isTmpDir("/tmp")).toBeFalsy();
    expect(isTmpDir("datatruck-tmp")).toBeFalsy();
    expect(isTmpDir(normalize(join(dir, "..")))).toBeFalsy();
  });
  test("returns true", () => {
    const dir = sessionTmpDir();
    expect(isTmpDir(dir)).toBeTruthy();
  });
});

describe("rmTmpDir", () => {
  test("throws error", async () => {
    const randomId = randomBytes(8).toString("hex");
    const testPath = join(tmpdir(), `test-${randomId}`);
    await mkdir(testPath, { recursive: true });
    try {
      await expect(rmTmpDir(testPath)).rejects.toBeInstanceOf(Error);
    } finally {
      await rmdir(testPath);
    }
  });
  test("removes temp dir created manually", async () => {
    const testPath = tmpDir("test");
    await mkdir(testPath, { recursive: true });
    try {
      await expect(rmTmpDir(testPath)).resolves.toBeUndefined();
    } catch (error) {
      await rmdir(testPath);
    }
  });

  test("removes temp dir created automatically", async () => {
    const testPath = await mkTmpDir("test");
    try {
      await expect(rmTmpDir(testPath)).resolves.toBeUndefined();
    } catch (error) {
      await rmdir(testPath);
    }
  });
});

describe("createWriteStreamPool", () => {
  const read = async (path: string) => (await readFile(path)).toString();
  test("creates multiple files", async () => {
    const path = await mkTmpDir("test");
    try {
      const pool = createWriteStreamPool({ path });
      pool.writeLine(1, "a");
      pool.writeLine(2, "b");
      pool.writeLine(1, "c");
      pool.writeLine(3, "d");
      await pool.end();
      expect(await read(pool.path(1)!)).toBe("a\nc");
      expect(await read(pool.path(2)!)).toBe("b");
      expect(await read(pool.path(3)!)).toBe("d");
    } catch (error) {
      await rm(path, { recursive: true });
      throw error;
    }
  });
});

describe("ensureFreeDiskSpace", async () => {
  const disk = await fetchDiskStats(".");
  const offset = 5 * 1024 * 1024;
  it("passes", async () => {
    await expect(
      ensureFreeDiskSpace(["."], disk.free - offset),
    ).resolves.toBeUndefined();
  });
  it("fails", async () => {
    await expect(
      ensureFreeDiskSpace(["."], disk.free + offset),
    ).rejects.toThrowError();
  });
});

describe("ensureSingleFile", async () => {
  it("passes", async () => {
    const path = await mkTmpDir("test", "ensureSingleFile");
    await writeFile(path + "/f1", "");
    await expect(ensureSingleFile(path)).resolves.toBe(join(path, "f1"));
  });
  it("fails with empty dir", async () => {
    const path = await mkTmpDir("test", "ensureSingleFile");
    await expect(ensureSingleFile(path)).rejects.toThrowError();
  });
  it("fails with dir", async () => {
    const path = await mkTmpDir("test", "ensureSingleFile");
    await writeFile(path + "/f1", "");
    await writeFile(path + "/f2", "");
    await expect(ensureSingleFile(path)).rejects.toThrowError();
  });
  it("fails uncreated dir", async () => {
    const path = await mkTmpDir("test", "ensureSingleFile");
    await rmdir(path);
    await expect(ensureSingleFile(path)).rejects.toThrowError();
  });
});

describe("groupFiles", async () => {
  it("groups files", async () => {
    const [files, compressed] = groupFiles(
      [
        "a.sql",
        "b.sql",
        "c.sql.tar.gz",
        "d.sql",
        "d.sql.tar.gz",
        "otherfile.tar.gz",
      ],
      [".sql"],
    );

    expect(files).toEqual(["a.sql", "b.sql", "c.sql", "d.sql"]);
    expect(compressed).toEqual({
      "c.sql": "c.sql.tar.gz",
      "d.sql": "d.sql.tar.gz",
    });
  });
});
