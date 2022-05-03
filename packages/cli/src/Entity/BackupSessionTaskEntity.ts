import Entity from "../Decorator/EntityDecorator";
import { StateEntityAbstract } from "./StateEntityAbstract";

@Entity({
  tableName: "backup_session_task",
})
export class BackupSessionTaskEntity extends StateEntityAbstract {
  sessionId!: number;
  taskName!: string;
}
