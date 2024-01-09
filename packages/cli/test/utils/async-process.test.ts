import { AsyncProcess } from "../../src/utils/async-process";
import { mkTmpDir } from "../../src/utils/temp";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { describe, it } from "vitest";
import { expect } from "vitest";

describe("AsyncProcess.stdout.fetch", () => {
  it("fetches stdout", async () => {
    const p = new AsyncProcess("node", ["-e", "process.stdout.write('1')"]);
    await expect(p.stdout.fetch()).resolves.toBe("1");
  });
  it("throws error", async () => {
    const p = new AsyncProcess("node", [
      "-e",
      "process.stdout.write('1'); process.exit(1);",
    ]);
    await expect(p.stdout.fetch()).rejects.toThrowError("Process exit code: 1");
  });
});

describe("AsyncProcess.stdout.parseLines", () => {
  it("iterates each non-empty line", async () => {
    const p = new AsyncProcess("node", [
      "-e",
      "console.log('line1'); console.log(' line2 '); console.log(''); console.log('  '); console.log('line3');",
    ]);
    const lines: string[] = [];
    await expect(
      p.stdout.parseLines((line) => {
        lines.push(line);
      }),
    ).resolves.toBe(3);
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });
});

describe("AsyncProcess.stderr.fetch", () => {
  it("fetches stderr", async () => {
    const p = new AsyncProcess("node", ["-e", "process.stderr.write('2')"]);
    await expect(p.stderr.fetch()).resolves.toBe("2");
  });
});

describe("AsyncProcess.waitForClose", () => {
  it("throws error", async () => {
    const p = new AsyncProcess("node", ["-e", "process.exit(3)"]);
    await expect(p.waitForClose()).rejects.toThrowError(
      new Error("Process exit code: 3"),
    );
  });
  it("silents the error", async () => {
    const p = new AsyncProcess("node", ["-e", "process.exit(3)"], {
      $exitCode: false,
    });
    await expect(p.waitForClose()).resolves.toBe(3);
  });
});

describe("AsyncProcess.stdout.pipe", () => {
  it("pipes to file", async () => {
    const p = new AsyncProcess("node", [
      "-e",
      "console.log('a'); console.log('b');",
    ]);
    const dir = await mkTmpDir("stdout.pipe");
    const path = join(dir, "file");
    await expect(p.stdout.pipe(path)).resolves.toBeUndefined();
    expect((await readFile(path)).toString()).toBe("a\nb\n");
  });

  it("pipes to other process", async () => {
    const p1 = new AsyncProcess("node", [
      "-e",
      "console.log('a'); console.log('b');",
    ]);
    const p2 = new AsyncProcess("node", [
      "-e",
      "process.stdin.on('data', (c) => process.stdout.write(c.toString().toUpperCase()));",
    ]);

    const [, stdout] = await Promise.all([
      p1.stdout.pipe(p2.stdin),
      p2.stdout.fetch(),
    ]);

    expect(stdout).toBe("A\nB");
  });
});

describe("AsyncProcess.stdin.pipe", () => {
  it("throws error", async () => {
    const p1 = new AsyncProcess("node", [
      "-e",
      "process.stdin.on('data', (c) => process.stdout.write(c.toString().toUpperCase()));",
    ]);

    const dir = await mkTmpDir("stdout.pipe");
    const path = join(dir, "file");
    await writeFile(path, "a\nbc");

    const [, stdout] = await Promise.all([
      p1.stdin.pipe(path),
      p1.stdout.fetch(),
    ]);

    expect(stdout).toBe("A\nBC");
  });
});

describe("AsyncProcess.options.$controller", () => {
  it("throws killed error", async () => {
    const $controller = new AbortController();
    const p1 = new AsyncProcess(
      "node",
      ["-e", "setTimeout(() => console.log('closed'), 5000);"],
      { $controller },
    );
    $controller.abort();
    await expect(p1.waitForClose()).rejects.toThrowError("Process killed");
  });
});
