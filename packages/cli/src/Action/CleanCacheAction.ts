import { existsDir, fastFolderSizeAsync } from "../utils/fs";
import { parentTmpDir } from "../utils/temp";
import { IfRequireKeys } from "../utils/ts";
import { rm } from "fs/promises";

export type CleanCacheActionOptions = {
  verbose?: boolean;
};

export class CleanCacheAction<TRequired extends boolean = true> {
  constructor(
    readonly options: IfRequireKeys<TRequired, CleanCacheActionOptions>,
  ) {}
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
