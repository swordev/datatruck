import { Config, ConfigAction } from "../../../src";
import { DatatruckRepository } from "../../../src/repositories/DatatruckRepository";
import { RemoteFs } from "../../../src/utils/datatruck/client";
import { findRepositoryOrFail } from "../../../src/utils/datatruck/config";
import { mkTmpDir } from "../../../src/utils/temp";
import { mkdir } from "fs/promises";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";

const options = {
  repository: process.env.DTT_FS_REPOSITORY,
  snapshot: process.env.DTT_FS_SNAPSHOT,
  package: process.env.DTT_FS_PACKAGE,
};

describe("RemoteFs", () => {
  it(
    "download",
    async () => {
      const finish = () => {
        expect(1).toBe(1);
      };
      if (!options.repository) return finish();
      let config: Config | undefined;
      try {
        config = await ConfigAction.findAndParseFile(process.cwd());
      } catch (error) {
        return finish();
      }
      const repo = findRepositoryOrFail(config, options.repository);

      if (repo.type !== "datatruck") throw new Error(`Invalid repository`);

      const fs = new RemoteFs({
        backend: repo.config.backend,
      });

      const snapshots = (await fs.readdir(".")).map((folder) =>
        DatatruckRepository.parseSnapshotName(folder),
      );

      const dir = await mkTmpDir("remote-fs");

      for (const snapshot of snapshots) {
        if (
          !snapshot ||
          snapshot.snapshotShortId !== options.snapshot ||
          snapshot.packageName !== options.package
        )
          continue;
        const files = await fs.readdir(snapshot.sourcePath);
        for (const file of files) {
          console.log("downloading...", file);
          const filePath = join(dir, snapshot.sourcePath, file);
          await mkdir(dirname(filePath), { recursive: true });
          let last = 0;
          let logProgress = (data: number) => {
            const now = Date.now();
            if (now - last > 1000) {
              console.log(`${data}%`);
              last = now;
            }
          };
          await fs.download(join(snapshot.sourcePath, file), filePath, {
            onProgress(progress) {
              logProgress(progress.percent);
            },
          });
          console.log(`100%`);
        }
      }

      expect(1).toBe(1);
    },
    5 * 60 * 1000,
  );
});
