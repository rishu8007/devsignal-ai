export interface PublicErrorDetails {
  fields: Record<string, string[]>;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly operational: boolean;
  public readonly details: PublicErrorDetails | undefined;

  public constructor(
    statusCode: number,
    code: string,
    message: string,
    operational = true,
    details?: PublicErrorDetails,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.operational = operational;
    this.details = details;
  }
}
