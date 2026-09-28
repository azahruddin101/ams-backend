import { AuditLog } from "../models/index.js";
import { logger } from "../config/logger.js";

const SENSITIVE = new Set(["logo", "passwordHash", "password", "embedding", "embeddingCipher", "refreshToken", "token", "passwordResetTokenHash"]);

function scrub(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const plain = typeof value.toObject === "function" ? value.toObject() : value;
    if (plain._bsontype === "ObjectId" || plain.constructor?.name === "ObjectId") return String(plain);
    return Object.fromEntries(Object.entries(plain).filter(([k]) => !SENSITIVE.has(k)).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}

/** ctx = { user, ip, userAgent } — obtained via auditContext(req). Never throws. */
export async function recordAudit(ctx, { action, entityType, entityId, before, after, companyId }) {
  try {
    await AuditLog.create({
      actorId: ctx?.user?.id,
      companyId: companyId ?? ctx?.user?.companyId ?? null,
      action,
      entityType,
      entityId,
      before: scrub(before),
      after: scrub(after),
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent?.slice(0, 300),
    });
  } catch (err) {
    logger.error({ msg: "audit log write failed", action, err: err.message });
  }
}

export const auditContext = (req) => ({ user: req.user, ip: req.ip, userAgent: req.get("user-agent") });
