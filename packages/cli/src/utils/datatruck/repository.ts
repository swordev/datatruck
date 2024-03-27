import {
  DatatruckRepository,
  datatruckRepositoryName,
} from "../../repositories/DatatruckRepository";
import {
  GitRepository,
  gitRepositoryName,
} from "../../repositories/GitRepository";
import type { RepositoryAbstract } from "../../repositories/RepositoryAbstract";
import {
  ResticRepository,
  resticRepositoryName,
} from "../../repositories/ResticRepository";
import { AppError } from "../error";
import { ensureFreeDiskSpace, initEmptyDir } from "../fs";
import type { RepositoryConfig } from "./config-type";

const repoMap = {
  [gitRepositoryName]: GitRepository,
  [resticRepositoryName]: ResticRepository,
  [datatruckRepositoryName]: DatatruckRepository,
};

export function getRepoConstructor(type: keyof typeof repoMap): {
  new (config: RepositoryConfig, verbose?: boolean): RepositoryAbstract<any>;
} {
  const Constructor = repoMap[type];
  if (!Constructor) throw new AppError(`Invalid repository type: ${type}`);
  return Constructor as any;
}

export function createRepo(
  repository: RepositoryConfig,
  verbose: boolean | undefined,
): RepositoryAbstract<any> {
  const Constructor = getRepoConstructor(repository.type);
  return new Constructor(repository, verbose);
}

export async function createAndInitRepo(
  repository: RepositoryConfig,
  verbose: boolean | undefined,
): Promise<RepositoryAbstract<any>> {
  const repo = createRepo(repository, verbose);
  await repo.init({ options: { verbose } });
  return repo;
}

export async function initSnapshotPath(
  path: string,
  minFreeDiskSpace?: string | number,
) {
  await initEmptyDir(path);
  if (minFreeDiskSpace) await ensureFreeDiskSpace([path], minFreeDiskSpace);
}
