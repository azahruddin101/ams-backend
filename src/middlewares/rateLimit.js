import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

const make = (windowMs, limit, message, extra = {}) =>
  rateLimit({
    ...extra,
    windowMs,
    limit: env.isTest ? 10000 : limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message, errors: [] },
  });

export const globalLimiter = make(60_000, 300, "Too many requests, please slow down");
// Brute-force protection counts FAILED logins only, so normal use never trips it.
export const authLimiter = make(15 * 60_000, 20, "Too many authentication attempts, try again later", { skipSuccessfulRequests: true });
// Every page load silently refreshes the session, so this needs headroom (it also cannot be used to guess passwords).
export const refreshLimiter = make(15 * 60_000, 300, "Too many session refreshes, try again shortly");
export const sensitiveLimiter = make(60_000, 10, "Too many requests to a sensitive endpoint");
export const scanLimiter = make(60_000, 60, "Too many scans, please wait a moment");
