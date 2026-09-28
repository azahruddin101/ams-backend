import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { RefreshToken } from "../models/index.js";
import { randomToken, sha256 } from "../utils/crypto.js";
import { AuthenticationError } from "../utils/errors.js";

const parseDuration = (s) => {
  const m = /^(\d+)([smhd])$/.exec(s);
  if (!m) throw new Error(`Invalid duration: ${s}`);
  return Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
};
// A rotated token presented again within this window is a benign race (two tabs, an app resuming from background, a retried
// request), not theft: reject it but keep the session. Outside the window it is treated as a stolen token and the family is revoked.
const REUSE_GRACE_MS = 10_000;

export const refreshTtlMs = () => parseDuration(env.JWT_REFRESH_EXPIRES_IN);

export const signAccessToken = (user) =>
  jwt.sign({ role: user.role, companyId: user.companyId ? String(user.companyId) : null }, env.JWT_ACCESS_SECRET, {
    subject: String(user._id),
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    algorithm: "HS256",
  });

export async function issueRefreshToken(user, meta, familyId = crypto.randomUUID()) {
  const token = randomToken();
  await RefreshToken.create({
    userId: user._id,
    tokenHash: sha256(token),
    familyId,
    expiresAt: new Date(Date.now() + refreshTtlMs()),
    userAgent: meta?.userAgent?.slice(0, 300),
    ipAddress: meta?.ip,
  });
  return token;
}

/** Rotates a refresh token. Presenting an already-rotated token revokes the whole family (theft signal). */
export async function rotateRefreshToken(rawToken, meta) {
  if (!rawToken) throw new AuthenticationError("Session expired");
  const hash = sha256(rawToken);
  const stored = await RefreshToken.findOne({ tokenHash: hash });
  if (!stored || stored.expiresAt < new Date()) throw new AuthenticationError("Session expired");
  if (stored.revokedAt) {
    const justRotated = stored.replacedByHash && Date.now() - stored.revokedAt.getTime() < REUSE_GRACE_MS;
    if (!justRotated) await RefreshToken.updateMany({ familyId: stored.familyId, revokedAt: null }, { revokedAt: new Date() });
    throw new AuthenticationError("Session expired");
  }
  const newToken = randomToken();
  const newHash = sha256(newToken);
  // Atomic claim so two concurrent refreshes can't both succeed.
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: stored._id, revokedAt: null },
    { revokedAt: new Date(), replacedByHash: newHash },
  );
  if (!claimed) throw new AuthenticationError("Session expired");
  await RefreshToken.create({
    userId: stored.userId,
    tokenHash: newHash,
    familyId: stored.familyId,
    expiresAt: new Date(Date.now() + refreshTtlMs()),
    userAgent: meta?.userAgent?.slice(0, 300),
    ipAddress: meta?.ip,
  });
  return { userId: stored.userId, refreshToken: newToken };
}

export const revokeRefreshToken = (raw) =>
  raw ? RefreshToken.updateOne({ tokenHash: sha256(raw), revokedAt: null }, { revokedAt: new Date() }) : null;
export const revokeAllForUser = (userId) => RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
