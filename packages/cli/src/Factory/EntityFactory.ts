import { BackupSessionEntity } from "../Entity/BackupSessionEntity";
import { BackupSessionRepositoryEntity } from "../Entity/BackupSessionRepositoryEntity";
import { BackupSessionTaskEntity } from "../Entity/BackupSessionTaskEntity";
import { RestoreSessionEntity } from "../Entity/RestoreSessionEntity";
import { RestoreSessionRepositoryEntity } from "../Entity/RestoreSessionRepositoryEntity";
import { RestoreSessionTaskEntity } from "../Entity/RestoreSessionTaskEntity";
import { AppError } from "../Error/AppError";
import { EntityEnum } from "../SessionDriver/SessionDriverAbstract";

export function Entity(type: EntityEnum) {
  const constructor = EntityConstructorFactory(type);
  return new constructor();
}

export function EntityConstructorFactory(type: EntityEnum) {
  if (type === EntityEnum.BackupSession) {
    return BackupSessionEntity;
  } else if (type === EntityEnum.BackupSessionRepository) {
    return BackupSessionRepositoryEntity;
  } else if (type === EntityEnum.BackupSessionTask) {
    return BackupSessionTaskEntity;
  } else if (type === EntityEnum.RestoreSession) {
    return RestoreSessionEntity;
  } else if (type === EntityEnum.RestoreSessionRepository) {
    return RestoreSessionRepositoryEntity;
  } else if (type === EntityEnum.RestoreSessionTask) {
    return RestoreSessionTaskEntity;
  } else {
    throw new AppError(`Invalid entity type: ${type}`);
  }
}
