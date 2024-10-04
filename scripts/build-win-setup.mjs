import { spawn } from "child_process";
import { readFile, writeFile } from "fs/promises";

const { version } = JSON.parse(
  (await readFile("./packages/datatruck/package.json")).toString(),
);

writeFile("./scripts/win-setup-config.h", `#define VERSION "${version}"`);

const exec = spawn("iscc.exe", ["./scripts/win-setup.iss"], {
  shell: true,
  stdio: "inherit",
});

exec.on("close", process.exit);
