import Entity from "../Decorator/EntityDecorator";
import { StateEntityAbstract } from "./StateEntityAbstract";

@Entity({
  tableName: "restore_session_repository",
})
export class RestoreSessionRepositoryEntity extends StateEntityAbstract {
  sessionId!: number;
  repositoryName!: string;
  repositoryType!: string;
}
