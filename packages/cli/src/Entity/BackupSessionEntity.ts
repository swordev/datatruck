import Entity from "./../Decorator/EntityDecorator";
import { StateEntityAbstract } from "./StateEntityAbstract";

@Entity({
  tableName: "backup_session",
})
export class BackupSessionEntity extends StateEntityAbstract {
  snapshotId!: string;
  packageName!: string;
  tags!: string | null;
}
