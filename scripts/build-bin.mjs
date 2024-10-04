import { exec } from "@yao-pkg/pkg";
import { readFile } from "fs/promises";

const { version } = JSON.parse(
  (await readFile("./packages/datatruck/package.json")).toString(),
);

await exec([
  "dist/datatruck.js",
  "-t",
  "win",
  "-o",
  `./bin/datatruck-${version}-win.exe`,
]);

await exec([
  "dist/datatruck.js",
  "-t",
  "linux",
  "-o",
  `./bin/datatruck-${version}-linux`,
]);
