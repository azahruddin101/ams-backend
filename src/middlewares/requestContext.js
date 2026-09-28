import crypto from "node:crypto";
import { logger } from "../config/logger.js";

export function requestContext(req, res, next) {
  req.id = req.get("x-request-id") || crypto.randomUUID();
  res.setHeader("x-request-id", req.id);
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    logger.info({
      msg: "request",
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      userId: req.user?.id,
      companyId: req.user?.companyId,
    });
  });
  next();
}
