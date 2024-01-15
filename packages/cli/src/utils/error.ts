export class AppError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = AppError.name;
  }
  static create(message: string, errors: Error[]) {
    if (errors.length === 1) {
      return errors[0];
    } else {
      return new AggregateError(errors, message);
    }
  }
}
