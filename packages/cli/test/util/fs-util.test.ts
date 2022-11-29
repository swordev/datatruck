import {
  isTmpDir,
  mkTmpDir,
  rmTmpDir,
  sessionTmpDir,
  tmpDir,
} from "../../src/util/fs-util";
import { randomBytes } from "crypto";
import { mkdir, rmdir } from "fs/promises";
import { tmpdir } from "os";
import { join, normalize } from "path";

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
