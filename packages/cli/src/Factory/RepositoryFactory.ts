import type { RepositoryConfigType } from "../Config/RepositoryConfig";
import { AppError } from "../Error/AppError";
import { GitRepository, gitRepositoryName } from "../Repository/GitRepository";
import {
  LocalRepository,
  localRepositoryName,
} from "../Repository/LocalRepository";
import type { RepositoryAbstract } from "../Repository/RepositoryAbstract";
import {
  ResticRepository,
  resticRepositoryName,
} from "../Repository/ResticRepository";

export function RepositoryFactory(
  repository: RepositoryConfigType
): RepositoryAbstract<any> {
  const type = repository.type;
  if (type === gitRepositoryName) {
    return new GitRepository(repository);
  } else if (type === resticRepositoryName) {
    return new ResticRepository(repository);
  } else if (type === localRepositoryName) {
    return new LocalRepository(repository);
  } else {
    throw new AppError(`Invalid repository type: ${type}`);
  }
}
