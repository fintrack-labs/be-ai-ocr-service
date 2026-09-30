export class ServiceError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}