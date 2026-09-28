import { defineRoutes } from "../utils/routeBuilder.js";
import * as c from "../controllers/misc.controller.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { idParams, listQuery } from "../validators/common.js";
import { leaveRequestSchema, decideLeaveSchema, leaveBalanceQuery, leaveListQuery, reportQuery, salaryReportQuery, notificationListQuery } from "../validators/org.js";

export const leaveRoutes = defineRoutes({ prefix: "/leaves", tag: "Leaves" }, [
  { method: "post", path: "/", summary: "Record leave for an employee (approved immediately, updates attendance)", permission: P.LEAVE_CREATE, body: leaveRequestSchema, handler: c.createLeave },
  { method: "get", path: "/", summary: "List leave", permission: P.LEAVE_READ, query: leaveListQuery, handler: c.listLeaves },
  { method: "get", path: "/balance", summary: "An employee's leave balance per type", permission: P.LEAVE_READ, query: leaveBalanceQuery, handler: c.leaveBalance },
  { method: "post", path: "/:id/approve", summary: "Approve a pending leave request (starts counting in attendance)", permission: P.LEAVE_APPROVE, params: idParams, body: decideLeaveSchema, handler: c.approveLeave },
  { method: "post", path: "/:id/reject", summary: "Reject a pending leave request", permission: P.LEAVE_APPROVE, params: idParams, body: decideLeaveSchema, handler: c.rejectLeave },
  { method: "post", path: "/:id/cancel", summary: "Cancel recorded leave (restores balance, recalculates attendance)", permission: P.LEAVE_CANCEL, params: idParams, handler: c.cancelLeave },
]);

const rep = (path, summary, handler) => ({ method: "get", path, summary, permission: P.REPORTS_READ, query: reportQuery, handler });
export const reportRoutes = defineRoutes({ prefix: "/reports", tag: "Reports" }, [
  rep("/daily", "Daily attendance report (json/csv)", c.dailyReport),
  rep("/monthly", "Monthly attendance sheet per employee", c.monthlyReport),
  rep("/employee", "Employee attendance report", c.employeeReport),
  rep("/late", "Late arrivals report", c.lateReport),
  rep("/overtime", "Overtime report", c.overtimeReport),
  rep("/leave", "Leave report", c.leaveReport),
  { method: "get", path: "/salary", summary: "Monthly salary sheet: salary, attendance deductions under each department's rules, net (json/csv)", permission: P.REPORTS_READ, query: salaryReportQuery, handler: c.salaryReport },
]);

export const dashboardRoutes = defineRoutes({ prefix: "/dashboard", tag: "Dashboard" }, [
  { method: "get", path: "/company", summary: "Company admin dashboard metrics", permission: P.DASHBOARD_READ, handler: c.dashboard },
  { method: "get", path: "/menu-counts", summary: "Numbers shown beside the menu entries, limited to what the signed-in login may see", handler: c.menuCounts },
]);

export const notificationRoutes = defineRoutes({ prefix: "/notifications", tag: "Notifications" }, [
  { method: "get", path: "/", summary: "My notifications", permission: P.NOTIFICATION_READ, tenant: false, query: notificationListQuery, handler: c.listNotifications },
  { method: "post", path: "/read-all", summary: "Mark all as read", permission: P.NOTIFICATION_READ, tenant: false, handler: c.markAllRead },
  { method: "post", path: "/:id/read", summary: "Mark as read", permission: P.NOTIFICATION_READ, tenant: false, params: idParams, handler: c.markRead },
]);

export const auditRoutes = defineRoutes({ prefix: "/audit-logs", tag: "Audit" }, [
  { method: "get", path: "/", summary: "Company audit trail", permission: P.AUDIT_READ, query: listQuery, handler: c.auditLogs },
]);
