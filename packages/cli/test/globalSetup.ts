import { parentTmpDir } from "../src/utils/fs";
import { rm } from "fs/promises";

export default async function () {
  return async () => {
    try {
      await rm(parentTmpDir(), {
        recursive: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}
