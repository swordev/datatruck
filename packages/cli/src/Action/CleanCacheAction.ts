import { existsDir, parentTmpDir } from "../utils/fs";
import { IfRequireKeys } from "../utils/ts";
import { rm } from "fs/promises";

export type CleanCacheActionOptionsType = {
  verbose?: boolean;
};

export class CleanCacheAction<TRequired extends boolean = true> {
  constructor(
    readonly options: IfRequireKeys<TRequired, CleanCacheActionOptionsType>
  ) {}
  async exec() {
    const path = parentTmpDir();
    if (await existsDir(path))
      await rm(path, {
        recursive: true,
      });
  }
}
