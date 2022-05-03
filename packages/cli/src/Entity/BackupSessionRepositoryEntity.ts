import Entity from "../Decorator/EntityDecorator";
import { StateEntityAbstract } from "./StateEntityAbstract";

@Entity({
  tableName: "backup_session_repository",
})
export class BackupSessionRepositoryEntity extends StateEntityAbstract {
  sessionId!: number;
  repositoryName!: string;
  repositoryType!: string;
}
