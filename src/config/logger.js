import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.isTest ? "silent" : env.LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  // Never emit credentials, tokens or biometric material.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.refreshToken",
      "*.accessToken",
      "*.embedding",
      "*.image",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
});
