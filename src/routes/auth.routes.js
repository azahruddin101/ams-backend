import { defineRoutes } from "../utils/routeBuilder.js";
import * as c from "../controllers/auth.controller.js";
import { authLimiter, refreshLimiter, sensitiveLimiter } from "../middlewares/rateLimit.js";
import { loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } from "../validators/auth.js";
import { idParams } from "../validators/common.js";

export default defineRoutes({ prefix: "/auth", tag: "Auth" }, [
  { method: "post", path: "/login", summary: "Log in with email and password", auth: false, limiter: authLimiter, body: loginSchema, handler: c.login },
  { method: "post", path: "/refresh", summary: "Rotate the refresh-token cookie and get a new access token", auth: false, limiter: refreshLimiter, handler: c.refresh },
  { method: "post", path: "/logout", summary: "Revoke the current refresh token", auth: false, handler: c.logout },
  { method: "post", path: "/forgot-password", summary: "Request a password reset", auth: false, limiter: sensitiveLimiter, body: forgotPasswordSchema, handler: c.forgotPassword },
  { method: "post", path: "/reset-password", summary: "Reset password using a reset token", auth: false, limiter: sensitiveLimiter, body: resetPasswordSchema, handler: c.resetPassword },
  { method: "post", path: "/change-password", summary: "Change password (revokes all sessions)", limiter: sensitiveLimiter, body: changePasswordSchema, handler: c.changePassword },
  { method: "get", path: "/me", summary: "Current user, permissions and company", handler: c.me },
  { method: "get", path: "/sessions", summary: "List active sessions", handler: c.sessions },
  { method: "delete", path: "/sessions/:id", summary: "Revoke a session", params: idParams, handler: c.revokeSession },
]);
