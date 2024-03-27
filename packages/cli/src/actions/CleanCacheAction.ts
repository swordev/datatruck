import { existsDir, fastFolderSizeAsync } from "../utils/fs";
import { InferOptions, OptionsConfig } from "../utils/options";
import { parentTmpDir } from "../utils/temp";
import { rm } from "fs/promises";

export const cleanCacheActionOptions = {} satisfies OptionsConfig;

export type CleanCacheActionOptions = InferOptions<
  typeof cleanCacheActionOptions
>;

export class CleanCacheAction {
  constructor(readonly options: CleanCacheActionOptions) {}
  async exec() {
    const path = parentTmpDir();
    let freedSize = 0;
    if (await existsDir(path)) {
      freedSize = await fastFolderSizeAsync(path);
      await rm(path, { recursive: true });
    }
    return { errors: [], path, freedSize };
  }
}
