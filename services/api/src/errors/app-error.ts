export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly operational: boolean;

  public constructor(
    statusCode: number,
    code: string,
    message: string,
    operational = true,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.operational = operational;
  }
}
