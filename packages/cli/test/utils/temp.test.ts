import { existsDir } from "../../src/utils/fs";
import { GargabeCollector, mkTmpDir } from "../../src/utils/temp";
import { describe, expect, it } from "vitest";

describe("GargabeCollector", () => {
  const expectDir = (path: string, state = true) =>
    expect(existsDir(path)).resolves.toBe(state);
  it("cleanup", async () => {
    const gc = new GargabeCollector();
    const path1 = await mkTmpDir("1");

    await expectDir(path1);
    expect(gc.paths.size).toBe(1);
    await gc.cleanup();
    await expectDir(path1, false);
    expect(gc.paths.size).toBe(0);

    const path2 = await mkTmpDir("2");
    await expectDir(path2);
    expect(gc.paths.size).toBe(1);
    await gc.cleanup();
    expect(gc.paths.size).toBe(0);
    await expectDir(path2, false);
  });
  it("dispose", async () => {
    const gc = new GargabeCollector();
    const path1 = await mkTmpDir("1");

    await expectDir(path1);
    await gc.dispose();
    await expectDir(path1, false);
    expect(gc.paths.size).toBe(0);

    const path2 = await mkTmpDir("2");
    await expectDir(path2);
    await gc.dispose();
    await expectDir(path2);
  });
  it("cleanup children", async () => {
    const gc1 = new GargabeCollector();
    const path1 = await mkTmpDir("1");
    const gc2 = gc1.create();
    const path2 = await mkTmpDir("2");

    expect(gc1.paths.size).toBe(1);
    expect(gc2.paths.size).toBe(1);
    await gc2.cleanup();
    await expectDir(path1);
    await expectDir(path2, false);
    await gc1.cleanup();
    await expectDir(path1, false);
    await expectDir(path2, false);
  });

  it("pending", async () => {
    const gc1 = new GargabeCollector();
    await mkTmpDir("1");
    const gc2 = new GargabeCollector();
    expect(gc1.pending()).toBe(true);
    expect(gc2.pending()).toBe(false);
    await gc2.cleanup();
    expect(gc2.pending()).toBe(false);
    await gc1.cleanup();
    expect(gc2.pending()).toBe(false);
  });
});
