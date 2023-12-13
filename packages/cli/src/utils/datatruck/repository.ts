import type { RepositoryConfig } from "../../Config/RepositoryConfig";
import {
  DatatruckRepository,
  datatruckRepositoryName,
} from "../../Repository/DatatruckRepository";
import {
  GitRepository,
  gitRepositoryName,
} from "../../Repository/GitRepository";
import type { RepositoryAbstract } from "../../Repository/RepositoryAbstract";
import {
  ResticRepository,
  resticRepositoryName,
} from "../../Repository/ResticRepository";
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
