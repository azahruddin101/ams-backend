import { ZodError } from "zod";
import mongoose from "mongoose";
import { AppError } from "../utils/errors.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

export const notFoundHandler = (req, _res, next) =>
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl.split("?")[0]}`, 404, { code: "NOT_FOUND" }));

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError)
    return new AppError("Validation failed", 422, {
      code: "VALIDATION_ERROR",
      errors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  if (err instanceof mongoose.Error.ValidationError)
    return new AppError("Validation failed", 422, {
      code: "VALIDATION_ERROR",
      errors: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    });
  if (err instanceof mongoose.Error.CastError) return new AppError("Invalid identifier", 400, { code: "BAD_REQUEST" });
  if (err?.code === 11000) return new AppError("A record with the same unique value already exists", 409, { code: "DUPLICATE" });
  if (err?.type === "entity.parse.failed") return new AppError("Malformed JSON body", 400, { code: "BAD_REQUEST" });
  if (err?.type === "entity.too.large") return new AppError("Request body too large", 413, { code: "PAYLOAD_TOO_LARGE" });
  if (err?.message === "Not allowed by CORS") return new AppError("Origin not allowed", 403, { code: "CORS" });
  return null;
}

export function errorHandler(err, req, res, _next) {
  const known = normalize(err);
  if (!known) {
    logger.error({ msg: "Unhandled error", requestId: req.id, err: { message: err?.message, stack: err?.stack } });
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again later.",
      errors: [],
      ...(env.isProd ? {} : { debug: err?.message }),
    });
  }
  if (known.statusCode >= 500) logger.error({ msg: known.message, requestId: req.id, stack: err.stack });
  return res.status(known.statusCode).json({ success: false, message: known.message, code: known.code, errors: known.errors ?? [] });
}
