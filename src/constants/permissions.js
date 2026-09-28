import { ROLES } from "./index.js";

export const PERMISSIONS = Object.freeze({
  COMPANY_MANAGE_ALL: "company.manage_all", // super admin: create/suspend companies and their logins
  COMPANY_READ: "company.read",
  COMPANY_UPDATE: "company.update",
  EMPLOYEE_CREATE: "employee.create",
  EMPLOYEE_READ: "employee.read",
  EMPLOYEE_UPDATE: "employee.update",
  EMPLOYEE_DELETE: "employee.delete",
  DEPARTMENT_READ: "department.read",
  DEPARTMENT_MANAGE: "department.manage",
  SHIFT_CREATE: "shift.create",
  SHIFT_READ: "shift.read",
  SHIFT_UPDATE: "shift.update",
  SHIFT_DELETE: "shift.delete",
  POLICY_READ: "attendance_policy.read",
  POLICY_UPDATE: "attendance_policy.update",
  HOLIDAY_READ: "holiday.read",
  HOLIDAY_MANAGE: "holiday.manage",
  LEAVE_TYPE_MANAGE: "leave_type.manage",
  LEAVE_CREATE: "leave.create",
  LEAVE_READ: "leave.read",
  LEAVE_CANCEL: "leave.cancel",
  LEAVE_APPROVE: "leave.approve", // company, and employees of a department that approves leave
  LEAVE_APPLY: "leave.apply", // an employee asking for their own leave
  SELF_READ: "self.read", // an employee reading their own profile, attendance and leave
  ATTENDANCE_SCAN: "attendance.scan", // the only permission an attendance device has
  ATTENDANCE_READ: "attendance.read",
  ATTENDANCE_UPDATE: "attendance.update",
  FACE_MANAGE: "face.manage",
  DEVICE_MANAGE: "device.manage",
  REPORTS_READ: "reports.read",
  AUDIT_READ: "audit.read",
  NOTIFICATION_READ: "notification.read",
  DASHBOARD_READ: "dashboard.read",
});

const P = PERMISSIONS;

const companyPerms = [
  P.COMPANY_READ, P.COMPANY_UPDATE,
  P.EMPLOYEE_CREATE, P.EMPLOYEE_READ, P.EMPLOYEE_UPDATE, P.EMPLOYEE_DELETE,
  P.DEPARTMENT_READ, P.DEPARTMENT_MANAGE,
  P.SHIFT_CREATE, P.SHIFT_READ, P.SHIFT_UPDATE, P.SHIFT_DELETE,
  P.POLICY_READ, P.POLICY_UPDATE, P.HOLIDAY_READ, P.HOLIDAY_MANAGE, P.LEAVE_TYPE_MANAGE,
  P.LEAVE_CREATE, P.LEAVE_READ, P.LEAVE_CANCEL, P.LEAVE_APPROVE,
  P.ATTENDANCE_SCAN, P.ATTENDANCE_READ, P.ATTENDANCE_UPDATE,
  P.FACE_MANAGE, P.DEVICE_MANAGE, P.REPORTS_READ,
  P.AUDIT_READ, P.NOTIFICATION_READ, P.DASHBOARD_READ,
];

/** Role → permission set. Add a role (or move this to the database) without touching any controller. */
export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: new Set([P.COMPANY_MANAGE_ALL, P.NOTIFICATION_READ, P.DASHBOARD_READ, P.AUDIT_READ]),
  [ROLES.COMPANY]: new Set(companyPerms),
  [ROLES.ATTENDANCE_DEVICE]: new Set([P.ATTENDANCE_SCAN]),
  [ROLES.EMPLOYEE]: new Set([P.SELF_READ, P.LEAVE_APPLY, P.NOTIFICATION_READ]),
});

/** Extra permissions an employee login gets from the authorities of its department. */
export const DEPARTMENT_AUTHORITY_PERMISSIONS = Object.freeze({
  canApproveLeave: [P.LEAVE_APPROVE],
  // adding people means filling the form (departments, shifts), fixing mistakes and registering the face
  canAddEmployees: [P.EMPLOYEE_CREATE, P.EMPLOYEE_READ, P.EMPLOYEE_UPDATE, P.FACE_MANAGE, P.DEPARTMENT_READ, P.SHIFT_READ],
});

export const hasPermission = (role, permission) => ROLE_PERMISSIONS[role]?.has(permission) ?? false;
export const permissionsForRole = (role) => [...(ROLE_PERMISSIONS[role] ?? [])];

/** Role permissions plus, for an employee login, whatever its department is trusted with. */
export function permissionsFor(role, department) {
  const perms = new Set(ROLE_PERMISSIONS[role] ?? []);
  if (role === ROLES.EMPLOYEE && department) {
    for (const [flag, extra] of Object.entries(DEPARTMENT_AUTHORITY_PERMISSIONS)) if (department[flag]) extra.forEach((p) => perms.add(p));
  }
  return [...perms];
}
