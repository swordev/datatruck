import Entity from "../Decorator/EntityDecorator";
import { StateEntityAbstract } from "./StateEntityAbstract";

@Entity({
  tableName: "restore_session",
})
export class RestoreSessionEntity extends StateEntityAbstract {
  snapshotId!: string;
  packageName!: string;
}
