import {
  createWriteStreamPool,
  isTmpDir,
  mkTmpDir,
  rmTmpDir,
  sessionTmpDir,
  tmpDir,
} from "../../src/utils/fs";
import { randomBytes } from "crypto";
import { mkdir, readFile, rm, rmdir } from "fs/promises";
import { tmpdir } from "os";
import { join, normalize } from "path";
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
