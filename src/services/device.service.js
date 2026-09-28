import { User, Employee } from "../models/index.js";
import { ROLES, EMPLOYEE_STATUS } from "../constants/index.js";
import { hashPassword } from "../utils/crypto.js";
import { ConflictError, NotFoundError, BadRequestError } from "../utils/errors.js";
import { paginateQuery, escapeRegex } from "../utils/pagination.js";
import { recordAudit } from "./audit.service.js";
import { revokeAllForUser } from "./token.service.js";
import { identifyEmployee, assertLivenessPolicy } from "./face.service.js";
import { FaceVerificationLog, AttendanceEvent } from "../models/index.js";
import { recordScan } from "./attendance.service.js";
import { env } from "../config/env.js";

/* ---------------- company manages its attendance devices (they are ordinary logins with the ATTENDANCE_DEVICE role) ---------------- */
const scoped = (companyId, id) => ({ _id: id, companyId, role: ROLES.ATTENDANCE_DEVICE });
const PUBLIC = "name email isActive lastLoginAt createdAt";

export async function listDevices(companyId, query) {
  const filter = { companyId, role: ROLES.ATTENDANCE_DEVICE };
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), "i");
  return paginateQuery(User, filter, query, { sortable: ["name", "createdAt", "lastLoginAt"], select: PUBLIC, defaultSort: "createdAt" });
}

export async function createDevice(ctx, companyId, { name, email, password }) {
  if (await User.exists({ email })) throw new ConflictError("A login with this email already exists");
  const user = await User.create({ name, email, passwordHash: await hashPassword(password), role: ROLES.ATTENDANCE_DEVICE, companyId });
  await recordAudit(ctx, { action: "device.created", entityType: "User", entityId: user._id, after: { name, email, role: ROLES.ATTENDANCE_DEVICE }, companyId });
  return user;
}

export async function updateDevice(ctx, companyId, id, { name, isActive, password }) {
  const user = await User.findOne(scoped(companyId, id)).select("+passwordHash");
  if (!user) throw new NotFoundError("Attendance device not found");
  if (name !== undefined) user.name = name;
  if (isActive !== undefined) user.isActive = isActive;
  if (password) { user.passwordHash = await hashPassword(password); user.passwordChangedAt = new Date(); }
  await user.save();
  if (isActive === false || password) await revokeAllForUser(user._id); // disabling or re-keying signs the device out at once
  await recordAudit(ctx, { action: "device.updated", entityType: "User", entityId: user._id, after: { name, isActive, passwordReset: Boolean(password) }, companyId });
  return user;
}

export async function removeDevice(ctx, companyId, id) {
  const user = await User.findOneAndDelete(scoped(companyId, id));
  if (!user) throw new NotFoundError("Attendance device not found");
  await revokeAllForUser(user._id);
  await recordAudit(ctx, { action: "device.deleted", entityType: "User", entityId: user._id, before: { name: user.name, email: user.email }, companyId });
}

/* ---------------- scanning ---------------- */
const brief = (e) => ({ firstName: e.firstName, lastName: e.lastName, employeeCode: e.employeeCode });
const logScan = (actor, data) => FaceVerificationLog.create({ companyId: actor.companyId, deviceUserId: actor.id, action: "IDENTIFY", provider: "device", ...data }).catch(() => {});

/**
 * Identify the face against this company's enrolled employees, then toggle check-in/check-out.
 * Unknown or ambiguous faces never record attendance.
 */
export async function scan({ actor, embedding, location, ip, userAgent }) {
  assertLivenessPolicy();
  const companyId = actor.companyId;
  const found = await identifyEmployee(companyId, { embedding });
  if (found.ambiguous) {
    await logScan(actor, { success: false, reason: "AMBIGUOUS", score: found.best?.score, ipAddress: ip });
    throw new BadRequestError("We couldn't tell who this is. Please try again.", "FACE_AMBIGUOUS");
  }
  const employee = found.matchedId && (await Employee.findOne({ _id: found.matchedId, companyId, status: EMPLOYEE_STATUS.ACTIVE }).lean());
  if (!employee) {
    await logScan(actor, { success: false, reason: "NO_MATCH", score: found.best?.score, ipAddress: ip });
    throw new BadRequestError("Face not recognised. Please try again, or ask your company to register you.", "FACE_NOT_RECOGNIZED");
  }

  const cooled = (last) => {
    logScan(actor, { success: true, employeeId: employee._id, reason: "COOLDOWN", score: found.best.score, ipAddress: ip });
    return { outcome: "COOLDOWN", employee: brief(employee), timestamp: last.timestamp, previous: last.previous ?? last.type };
  };
  let result;
  try {
    result = await recordScan({ companyId, employeeId: employee._id, deviceUserId: actor.id, score: found.best.score, location, ip, userAgent, cooldownSeconds: env.SCAN_COOLDOWN_SECONDS });
  } catch (err) {
    if (err.code !== "CONCURRENT_REQUEST") throw err;
    // Lost a race with a scan of the same person that landed a moment earlier: they ARE recorded, so report that.
    const last = await AttendanceEvent.findOne({ companyId, employeeId: employee._id, voidedAt: null }).sort({ timestamp: -1 }).select("type timestamp").lean();
    return cooled(last);
  }
  if (result.cooldown) return cooled(result.cooldown);
  const { record, event } = result;
  await logScan(actor, { success: true, employeeId: employee._id, score: found.best.score, ipAddress: ip });
  return {
    outcome: event.type, employee: brief(employee), timestamp: event.timestamp,
    workedMinutes: record?.totalWorkingMinutes ?? 0, status: record?.status, isLate: Boolean(record?.isLate), lateMinutes: record?.lateMinutes ?? 0,
  };
}
