import { assertDumpFile } from "../../src/utils/mysql";
import { mkTmpDir } from "../../src/utils/temp";
import { writeFile } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("assertDumpFile", async () => {
  const $assertDumpFile = async (lines: string[]) => {
    const dir = await mkTmpDir("test", "mysql", "assertDumpFile");
    const path = join(dir, "file.sql");
    await writeFile(path, lines.join("\n"));
    return assertDumpFile(path);
  };
  it("is valid", async () => {
    await expect(
      $assertDumpFile([
        "-- TEST",
        "-- mysql dump",
        "INSERT INTO...",
        "-- dump completed",
      ]),
    ).resolves.toBeUndefined();
  });
  it("throws error due to missing start line", async () => {
    await expect(
      $assertDumpFile(["-- TEST", "INSERT INTO...", "-- dump completed"]),
    ).rejects.toThrowError();
  });
  it("throws error due to missing end line", async () => {
    await expect(
      $assertDumpFile(["-- TEST", "-- mysql dump", "INSERT INTO..."]),
    ).rejects.toThrowError();
  });
  it("throws error due to missing line salt", async () => {
    await expect(
      $assertDumpFile([
        "-- TEST",
        "-- mysql dump",
        "INSERT INTO...-- dump completed",
      ]),
    ).rejects.toThrowError();
  });
});
