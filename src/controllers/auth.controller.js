import * as auth from "../services/auth.service.js";
import { ok } from "../utils/response.js";
import { env } from "../config/env.js";
import { AUTH } from "../constants/index.js";
import { refreshTtlMs } from "../services/token.service.js";
import { User } from "../models/index.js";

const meta = (req) => ({ ip: req.ip, userAgent: req.get("user-agent") });
const cookieOpts = () => ({ httpOnly: true, secure: env.cookieSecure, sameSite: "lax", path: "/api/v1/auth", maxAge: refreshTtlMs() });
// Non-secret hint (role only) so the Next.js proxy can redirect early. It grants nothing: the API enforces everything.
const hintOpts = () => ({ httpOnly: false, secure: env.cookieSecure, sameSite: "lax", path: "/", maxAge: refreshTtlMs() });
const setRefresh = (res, token, role) => {
  res.cookie(AUTH.REFRESH_COOKIE, token, cookieOpts());
  if (role) res.cookie(AUTH.SESSION_HINT_COOKIE, role, hintOpts());
};
const clearRefresh = (res) => {
  res.clearCookie(AUTH.REFRESH_COOKIE, { ...cookieOpts(), maxAge: undefined });
  res.clearCookie(AUTH.SESSION_HINT_COOKIE, { ...hintOpts(), maxAge: undefined });
};

export async function login(req, res) {
  const { user, accessToken, refreshToken } = await auth.login(req.validated.body, meta(req));
  setRefresh(res, refreshToken, user.role);
  return ok(res, { user, accessToken }, "Logged in successfully");
}
export async function refresh(req, res) {
  try {
    const { accessToken, refreshToken, user } = await auth.refresh(req.cookies?.[AUTH.REFRESH_COOKIE], meta(req));
    setRefresh(res, refreshToken, user.role);
    return ok(res, { user, accessToken }, "Token refreshed");
  } catch (err) {
    clearRefresh(res);
    throw err;
  }
}
export async function logout(req, res) {
  await auth.logout(req.cookies?.[AUTH.REFRESH_COOKIE]);
  clearRefresh(res);
  return ok(res, null, "Logged out");
}
export async function forgotPassword(req, res) {
  await auth.forgotPassword(req.validated.body.email);
  return ok(res, null, "If an account exists, password reset instructions have been sent");
}
export async function resetPassword(req, res) {
  await auth.resetPassword(req.validated.body);
  return ok(res, null, "Password reset successfully. Please log in.");
}
export async function changePassword(req, res) {
  await auth.changePassword(req.user.id, req.validated.body);
  clearRefresh(res);
  return ok(res, null, "Password changed. Please log in again.");
}
export async function me(req, res) {
  return ok(res, await auth.publicUser(await User.findById(req.user.id)));
}
export async function sessions(req, res) {
  return ok(res, await auth.listSessions(req.user.id));
}
export async function revokeSession(req, res) {
  await auth.revokeSession(req.user.id, req.validated.params.id);
  return ok(res, null, "Session revoked");
}
