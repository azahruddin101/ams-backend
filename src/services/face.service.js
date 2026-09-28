import { FaceProfile, FaceVerificationLog, Employee } from "../models/index.js";
import { FACE_MODES, FACE_PROFILE_STATUS } from "../constants/index.js";
import { env } from "../config/env.js";
import { encryptEmbedding, decryptEmbedding } from "../utils/crypto.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { getFaceProvider } from "./face/index.js";
import { recordAudit } from "./audit.service.js";

async function assertEmployee(companyId, employeeId) {
  if (!(await Employee.exists({ _id: employeeId, companyId }))) throw new NotFoundError("Employee not found");
}

/**
 * 1:N identification within ONE company (tenant isolation applies to biometrics too).
 * Templates are decrypted only for the duration of the comparison.
 */
export async function identifyEmployee(companyId, input, { excludeEmployeeId } = {}) {
  const provider = getFaceProvider();
  const filter = { companyId, status: FACE_PROFILE_STATUS.ACTIVE };
  if (excludeEmployeeId) filter.employeeId = { $ne: excludeEmployeeId };
  const profiles = await FaceProfile.find(filter).select("+embeddingCipher employeeId").lean();
  const candidates = profiles.map((p) => ({ id: String(p.employeeId), template: decryptEmbedding(p.embeddingCipher) }));
  return provider.identify(input, candidates);
}

/** Fail closed: if liveness is demanded but the provider cannot do it, scans are refused instead of silently weakened. */
export function assertLivenessPolicy() {
  if (env.FACE_LIVENESS_MODE === FACE_MODES.FACE_AND_LIVENESS && !getFaceProvider().supportsLiveness) {
    throw new BadRequestError("Liveness verification is required but not available on this server", "LIVENESS_UNAVAILABLE");
  }
}

export async function registerFace(ctx, companyId, employeeId, input) {
  await assertEmployee(companyId, employeeId);
  const provider = getFaceProvider();
  const { template } = await provider.registerFace(input);
  // The same person must not be enrolled under two identities (would enable buddy-punching and break 1:N).
  const dup = await identifyEmployee(companyId, input, { excludeEmployeeId: employeeId });
  if (dup.matchedId || dup.ambiguous) throw new ConflictError("This face looks like it is already registered to another employee", "FACE_DUPLICATE");

  await FaceProfile.updateMany({ companyId, employeeId, status: FACE_PROFILE_STATUS.ACTIVE }, { status: FACE_PROFILE_STATUS.REPLACED, deactivatedAt: new Date() });
  const profile = await FaceProfile.create({
    companyId, employeeId, provider: provider.name, modelVersion: provider.modelVersion,
    embeddingCipher: encryptEmbedding(template), registeredBy: ctx.user.id,
  });
  await FaceVerificationLog.create({ companyId, employeeId, action: "REGISTER", success: true, provider: provider.name, ipAddress: ctx.ip });
  await recordAudit(ctx, { action: "face.registered", entityType: "FaceProfile", entityId: profile._id, companyId, after: { employeeId, provider: provider.name } });
  return { registered: true, registeredAt: profile.createdAt, provider: provider.name };
}

export async function deactivateFace(ctx, companyId, employeeId) {
  await assertEmployee(companyId, employeeId);
  const r = await FaceProfile.updateMany({ companyId, employeeId, status: FACE_PROFILE_STATUS.ACTIVE }, { status: FACE_PROFILE_STATUS.DEACTIVATED, deactivatedAt: new Date() });
  await FaceVerificationLog.create({ companyId, employeeId, action: "DEACTIVATE", success: true, ipAddress: ctx.ip });
  await recordAudit(ctx, { action: "face.deactivated", entityType: "FaceProfile", entityId: employeeId, companyId });
  return { deactivated: r.modifiedCount > 0 };
}

export const listFaceLogs = (companyId, employeeId, limit = 50) =>
  FaceVerificationLog.find({ companyId, ...(employeeId ? { employeeId } : {}) }).sort({ createdAt: -1 }).limit(limit).lean();
