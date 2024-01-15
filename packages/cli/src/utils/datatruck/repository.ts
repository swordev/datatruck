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
import type { RepositoryConfig } from "./config-type";

const repoMap = {
  [gitRepositoryName]: GitRepository,
  [resticRepositoryName]: ResticRepository,
  [datatruckRepositoryName]: DatatruckRepository,
};

export function getRepoConstructor(type: keyof typeof repoMap): {
  new (config: RepositoryConfig): RepositoryAbstract<any>;
} {
  const Constructor = repoMap[type];
  if (!Constructor) throw new AppError(`Invalid repository type: ${type}`);
  return Constructor as any;
}

export function createRepo(
  repository: RepositoryConfig,
): RepositoryAbstract<any> {
  const Constructor = getRepoConstructor(repository.type);
  return new Constructor(repository);
}

export async function createAndInitRepo(
  repository: RepositoryConfig,
  verbose?: boolean,
): Promise<RepositoryAbstract<any>> {
  const repo = createRepo(repository);
  await repo.init({ options: { verbose } });
  return repo;
}
