import { Config } from "../config.js";
import { formatBytes } from "@datatruck/cli/utils/bytes.js";
import { fetchDiskStats } from "@datatruck/cli/utils/fs.js";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import { hostname } from "os";
import { join, relative } from "path";

export type CreateOptions = {
  cwd: string;
  config: string;
  force?: boolean;
};

export class Create {
  constructor() {}

  protected random() {
    return crypto.randomUUID().replaceAll("-", "");
  }

  async run(options: CreateOptions) {
    const stats = await fetchDiskStats(options.cwd);
    const minFreeSpaceBytes = (stats.total * 25) / 100;
    const minFreeSpace = formatBytes(minFreeSpaceBytes);
    const cwd = process.cwd();
    const config: Config = {
      $schema: "https://unpkg.com/@datatruck/restic/config.schema.json",
      hostname: hostname(),
      minFreeSpace,
      ntfyToken: this.random(),
      packages: [
        {
          name: "default",
          path: join(cwd, "data").replaceAll("\\", "/"),
        },
      ],
      prunePolicy: {
        keepDaily: 7,
        keepMonthly: 12,
        keepYearly: 5,
      },
      repositories: [
        {
          name: "default",
          uri: join(cwd, "repo").replaceAll("\\", "/"),
          password: this.random(),
        },
      ],
    };

    const configPath = join(cwd, options.config);

    if (existsSync(configPath) && !options.force)
      throw new Error(`Config file already exists at path: ${configPath}`);

    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

    const relativeConfigPath = relative(cwd, configPath);
    console.log(`- Created config file at path: ${relativeConfigPath}`);
    console.info(
      `- Show log remotly via ntfy: https://ntfy.sh/${config.ntfyToken}`,
    );
  }
}
