import { parentTmpDir } from "../src/utils/temp";
import { rm } from "fs/promises";

export default async function () {
  return async () => {
    try {
      if (!process.env.DEBUG)
        await rm(parentTmpDir(), {
          recursive: true,
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}
