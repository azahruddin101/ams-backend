export class AppError extends Error {
  constructor(message, statusCode = 500, { code = "INTERNAL_ERROR", errors = [], isOperational = true } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    this.isOperational = isOperational;
  }
}
export class ValidationError extends AppError {
  constructor(message = "Validation failed", errors = []) {
    super(message, 422, { code: "VALIDATION_ERROR", errors });
  }
}
export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, { code: "UNAUTHENTICATED" });
  }
}
export class AuthorizationError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403, { code: "FORBIDDEN" });
  }
}
export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, { code: "NOT_FOUND" });
  }
}
export class ConflictError extends AppError {
  constructor(message = "Resource conflict", code = "CONFLICT") {
    super(message, 409, { code });
  }
}
export class BadRequestError extends AppError {
  constructor(message = "Bad request", code = "BAD_REQUEST", errors = []) {
    super(message, 400, { code, errors });
  }
}
