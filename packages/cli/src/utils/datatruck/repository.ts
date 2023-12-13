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
import type { RepositoryConfig } from "./config-type";
import { AppError } from "./error";

export function createRepo(
  repository: RepositoryConfig,
): RepositoryAbstract<any> {
  const type = repository.type;
  if (type === gitRepositoryName) {
    return new GitRepository(repository);
  } else if (type === resticRepositoryName) {
    return new ResticRepository(repository);
  } else if (type === datatruckRepositoryName) {
    return new DatatruckRepository(repository);
  } else {
    throw new AppError(`Invalid repository type: ${type}`);
  }
}
