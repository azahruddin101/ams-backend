import { User, Company, Employee, RefreshToken } from "../models/index.js";
import { AUTH, ROLES, COMPANY_STATUS, EMPLOYEE_STATUS } from "../constants/index.js";
import { permissionsFor } from "../constants/permissions.js";
import { hashPassword, verifyPassword, randomToken, sha256 } from "../utils/crypto.js";
import { AuthenticationError, AuthorizationError, BadRequestError, NotFoundError } from "../utils/errors.js";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllForUser } from "./token.service.js";
import { recordAudit } from "./audit.service.js";
import { notify } from "./notification.service.js";
import { NOTIFICATION_CHANNELS } from "../constants/index.js";
import { logger } from "../config/logger.js";

const dummyHash = hashPassword("timing-equaliser-not-a-real-password");

export async function publicUser(user) {
  const u = user.toJSON ? user.toJSON() : user;
  let company = null;
  if (u.companyId) company = await Company.findById(u.companyId).select("name timezone currency status logo theme settings.geofence").lean();
  let department = null;
  if (u.role === ROLES.EMPLOYEE) department = (await Employee.findOne({ _id: u.employeeId, companyId: u.companyId }).select("departmentId").populate("departmentId", "canApproveLeave canAddEmployees").lean())?.departmentId;
  return { ...u, permissions: permissionsFor(u.role, department), company };
}

async function assertCompanyUsable(user) {
  if (user.role === ROLES.SUPER_ADMIN) return;
  const company = await Company.findById(user.companyId).select("status").lean();
  if (!company || [COMPANY_STATUS.SUSPENDED, COMPANY_STATUS.CANCELLED].includes(company.status)) {
    throw new AuthorizationError("Your company account is not active. Contact support.");
  }
  if (user.role === ROLES.EMPLOYEE && !(await Employee.exists({ _id: user.employeeId, companyId: user.companyId, status: EMPLOYEE_STATUS.ACTIVE }))) {
    throw new AuthorizationError("Account is disabled");
  }
}

export async function login({ email, password }, meta) {
  const user = await User.findOne({ email }).select("+passwordHash +failedLoginCount +lockedUntil");
  if (!user) {
    await verifyPassword(await dummyHash, password); // equalise timing
    throw new AuthenticationError("Invalid email or password");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AuthenticationError("Account temporarily locked due to repeated failed logins. Try again later.");
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    user.failedLoginCount = (user.failedLoginCount ?? 0) + 1;
    if (user.failedLoginCount >= AUTH.MAX_FAILED_LOGINS) {
      user.lockedUntil = new Date(Date.now() + AUTH.LOCK_MINUTES * 60_000);
      user.failedLoginCount = 0;
    }
    await user.save();
    throw new AuthenticationError("Invalid email or password");
  }
  if (!user.isActive) throw new AuthorizationError("Account is disabled");
  await assertCompanyUsable(user);

  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const refreshToken = await issueRefreshToken(user, meta);
  await recordAudit({ user: { id: String(user._id), companyId: user.companyId }, ...meta }, { action: "auth.login", entityType: "User", entityId: user._id });
  return { user: await publicUser(user), accessToken: signAccessToken(user), refreshToken };
}

export async function refresh(rawToken, meta) {
  const { userId, refreshToken } = await rotateRefreshToken(rawToken, meta);
  const user = await User.findById(userId);
  if (!user || !user.isActive) throw new AuthenticationError("Session expired");
  await assertCompanyUsable(user);
  return { accessToken: signAccessToken(user), refreshToken, user: await publicUser(user) };
}

export const logout = (rawToken) => revokeRefreshToken(rawToken);

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new BadRequestError("Current password is incorrect", "INVALID_PASSWORD");
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllForUser(user._id); // sign out every session
}

export async function forgotPassword(email) {
  const user = await User.findOne({ email, isActive: true }).select("+passwordResetTokenHash");
  if (!user) return; // never reveal whether the account exists
  const token = randomToken(32);
  user.passwordResetTokenHash = sha256(token);
  user.passwordResetExpiresAt = new Date(Date.now() + AUTH.RESET_TOKEN_MINUTES * 60_000);
  await user.save();
  await notify({ to: user.email, title: "Reset your password", body: `Reset token (valid ${AUTH.RESET_TOKEN_MINUTES} min): ${token}` }, [NOTIFICATION_CHANNELS.EMAIL]);
  if (process.env.NODE_ENV === "development") logger.warn({ msg: "DEV ONLY password reset token", email: user.email, token });
}

export async function resetPassword({ token, newPassword }) {
  const user = await User.findOne({ passwordResetTokenHash: sha256(token), passwordResetExpiresAt: { $gt: new Date() } }).select("+passwordHash +passwordResetTokenHash +passwordResetExpiresAt");
  if (!user) throw new BadRequestError("Reset link is invalid or has expired", "INVALID_RESET_TOKEN");
  user.passwordHash = await hashPassword(newPassword);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.passwordChangedAt = new Date();
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();
  await revokeAllForUser(user._id);
}

export const listSessions = (userId) =>
  RefreshToken.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } }).select("userAgent ipAddress createdAt expiresAt familyId").sort({ createdAt: -1 }).lean();

export async function revokeSession(userId, sessionId) {
  const s = await RefreshToken.findOne({ _id: sessionId, userId });
  if (!s) throw new NotFoundError("Session not found");
  await RefreshToken.updateMany({ familyId: s.familyId, revokedAt: null }, { revokedAt: new Date() });
}
