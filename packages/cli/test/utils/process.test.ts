import { createProcess } from "../../src/utils/process";
import { describe, it } from "vitest";
import { expect } from "vitest";

describe("createProcess", () => {
  it("pipes other process", async () => {
    const p1 = createProcess("printf", [[1, 2, 3, 4, 5].join("\\n")], {
      $stdout: { save: true },
    });
    const p2 = createProcess("grep", ["3"], {
      $stdout: { save: true },
    });
    p1.stdout.pipe(p2.stdin, { end: true });
    const [p1Result, p2Result] = await Promise.all([p1, p2]);

    expect(p1Result.exitCode).toBe(0);
    expect(p1Result.stdout).toBe("1\n2\n3\n4\n5");
    expect(p2Result.exitCode).toBe(0);
    expect(p2Result.stdout).toBe("3\n");
  });
});
