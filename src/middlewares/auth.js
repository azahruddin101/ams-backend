import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User, Company, Employee } from "../models/index.js";
import { AuthenticationError, AuthorizationError } from "../utils/errors.js";
import { ROLES, COMPANY_STATUS, EMPLOYEE_STATUS } from "../constants/index.js";
import { permissionsFor } from "../constants/permissions.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/** Verifies the bearer access token and hydrates req.user from the DB (so revocation/deactivation is immediate). */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new AuthenticationError();
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw new AuthenticationError("Invalid or expired access token");
  }
  const user = await User.findById(payload.sub).lean();
  if (!user || !user.isActive) throw new AuthenticationError("Account is disabled");
  if (user.role !== ROLES.SUPER_ADMIN) {
    const company = await Company.findById(user.companyId).select("name status timezone").lean();
    if (!company || [COMPANY_STATUS.SUSPENDED, COMPANY_STATUS.CANCELLED].includes(company.status)) {
      throw new AuthorizationError("Company account is not active");
    }
    req.company = company;
  }
  // An employee login is only as good as the employee behind it, and its powers come from that employee's department today.
  let department = null;
  if (user.role === ROLES.EMPLOYEE) {
    const employee = await Employee.findOne({ _id: user.employeeId, companyId: user.companyId, status: EMPLOYEE_STATUS.ACTIVE }).select("departmentId").populate("departmentId", "canApproveLeave canAddEmployees").lean();
    if (!employee) throw new AuthenticationError("Account is disabled");
    department = employee.departmentId;
  }
  req.user = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    companyId: user.companyId ? String(user.companyId) : null,
    employeeId: user.employeeId ? String(user.employeeId) : null,
    permissions: permissionsFor(user.role, department),
  };
  next();
});

/** Permission-based authorization. Passes if the role has ANY of the listed permissions. */
export const authorize = (...permissions) => (req, _res, next) => {
  if (!req.user) return next(new AuthenticationError());
  if (permissions.some((p) => req.user.permissions.includes(p))) return next();
  return next(new AuthorizationError());
};

export const requireTenant = (req, _res, next) =>
  req.user?.companyId ? next() : next(new AuthorizationError("This endpoint requires a company account"));
