export class PosError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PosError";
    this.code = code;
    this.status = status;
  }
}

export function isPosError(err: unknown): err is PosError {
  return err instanceof PosError;
}
