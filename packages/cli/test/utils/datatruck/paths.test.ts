import {
  BackupPathsOptions,
  parseBackupPaths,
  parsePaths,
} from "../../../src/utils/datatruck/paths";
import { platform } from "os";
import { describe, expect, it } from "vitest";

describe("parsePaths", () => {
  const options: BackupPathsOptions = {
    package: { name: "test" },
    snapshot: { date: "", id: "" },
    path: "",
  };
  it("returns same input", async () => {
    expect(await parsePaths(["a", "b"], {})).toMatchObject(["a", "b"]);
  });

  it("returns one path from stdout", async () => {
    expect(
      await parseBackupPaths(
        [
          {
            type: "process",
            config:
              platform() === "win32"
                ? {
                    command: "cmd",
                    args: ["/c", "echo file1"],
                  }
                : {
                    command: "echo",
                    args: ["file1"],
                  },
          },
        ],
        options,
      ),
    ).toMatchObject(["file1"]);
  });

  if (platform() !== "win32")
    it("returns multiple paths from stdout", async () => {
      expect(
        await parsePaths(
          [
            {
              type: "process",
              config: {
                command: "printf",
                args: ["file1\\nfile2"],
              },
            },
          ],
          options,
        ),
      ).toMatchObject(["file1", "file2"]);
    });

  it("returns mixed paths", async () => {
    expect(
      await parsePaths(
        [
          "file1",
          {
            type: "process",
            config:
              platform() === "win32"
                ? {
                    command: "cmd",
                    args: ["/c", "echo file2"],
                  }
                : {
                    command: "echo",
                    args: ["file2"],
                  },
          },
          "file3",
        ],
        options,
      ),
    ).toMatchObject(["file1", "file2", "file3"]);
  });
});
