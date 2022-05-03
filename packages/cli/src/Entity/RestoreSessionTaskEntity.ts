import Entity from "../Decorator/EntityDecorator";
import { StateEntityAbstract } from "./StateEntityAbstract";

@Entity({
  tableName: "restore_session_task",
})
export class RestoreSessionTaskEntity extends StateEntityAbstract {
  sessionId!: number;
  taskName!: string;
}
