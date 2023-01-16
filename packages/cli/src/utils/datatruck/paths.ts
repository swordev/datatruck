import { PathsObjectType } from "../../Config/PackageConfig";
import { exec } from "../process";

export async function parsePaths(
  values: (string | PathsObjectType)[],
  options: {
    cwd?: string;
    verbose?: boolean;
  }
) {
  let paths: string[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      paths.push(value);
    } else if (value.type === "spawn") {
      const spawnResult = await exec(
        value.command,
        value.args,
        { cwd: options.cwd },
        { log: options.verbose, stderr: { save: true }, stdout: { save: true } }
      );
      const spawnFiles = [spawnResult.stderr, spawnResult.stdout].flatMap(
        (text) =>
          text
            .split(/\r?\n/)
            .map((v) => v.trim())
            .filter((v) => !!v.length)
      );
      paths.push(...spawnFiles);
    }
  }
  return paths;
}
