import { parsePaths } from "../../../src/utils/datatruck/paths";
import { platform } from "os";
import { describe, expect, it } from "vitest";

describe("parsePaths", () => {
  it("returns same input", async () => {
    expect(await parsePaths(["a", "b"], {})).toMatchObject(["a", "b"]);
  });

  it("returns one path from stdout", async () => {
    expect(
      await parsePaths(
        [
          {
            type: "spawn",
            command: "echo",
            args: ["file1"],
          },
        ],
        {},
      ),
    ).toMatchObject(["file1"]);
  });

  if (platform() !== "win32")
    it("returns multiple paths from stdout", async () => {
      expect(
        await parsePaths(
          [
            {
              type: "spawn",
              command: "printf",
              args: ["file1\\nfile2"],
            },
          ],
          {},
        ),
      ).toMatchObject(["file1", "file2"]);
    });

  it("returns mixed paths", async () => {
    expect(
      await parsePaths(
        [
          "file1",
          {
            type: "spawn",
            command: "echo",
            args: ["file2"],
          },
          "file3",
        ],
        {},
      ),
    ).toMatchObject(["file1", "file2", "file3"]);
  });
});
