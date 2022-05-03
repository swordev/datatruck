export abstract class CrudEntityAbstract {
  id!: number;
  creationDate!: string;
  updatingDate?: string | null;
}
