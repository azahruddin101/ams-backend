import { defineRoutes } from "../utils/routeBuilder.js";
import * as c from "../controllers/me.controller.js";
import * as misc from "../controllers/misc.controller.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { idParams } from "../validators/common.js";
import { applyLeaveSchema, decideLeaveSchema, myAttendanceQuery, myLeavesQuery } from "../validators/org.js";

/** The signed-in employee's own data. Only employee logins hold `self.read` / `leave.apply`. */
export const meRoutes = defineRoutes({ prefix: "/me", tag: "Employee self-service" }, [
  { method: "get", path: "/", summary: "My profile, today's attendance, this month's summary and the rules that apply to me", permission: P.SELF_READ, handler: c.profile },
  { method: "get", path: "/attendance", summary: "My attendance records", permission: P.SELF_READ, query: myAttendanceQuery, handler: c.attendance },
  { method: "get", path: "/leaves", summary: "My leave requests", permission: P.SELF_READ, query: myLeavesQuery, handler: c.leaves },
  { method: "get", path: "/leave-balance", summary: "My leave balance per type", permission: P.SELF_READ, handler: c.leaveBalance },
  { method: "get", path: "/leave-types", summary: "Leave types I can apply for", permission: P.LEAVE_APPLY, handler: c.leaveTypes },
  { method: "get", path: "/leave-approvers", summary: "People I can ask to approve my leave (employees of departments that approve leave)", permission: P.LEAVE_APPLY, handler: c.leaveApprovers },
  { method: "get", path: "/leave-options", summary: "Everything the apply-for-leave form needs: types with balance, approvers, colleagues to report to, week-offs and holidays", permission: P.LEAVE_APPLY, handler: c.leaveOptions },
  { method: "post", path: "/leaves", summary: "Apply for leave (waits for the chosen approver)", permission: P.LEAVE_APPLY, body: applyLeaveSchema, handler: c.applyLeave },
  { method: "post", path: "/leaves/:id/withdraw", summary: "Withdraw my request while it is still waiting", permission: P.LEAVE_APPLY, params: idParams, handler: c.withdrawLeave },
  { method: "get", path: "/approvals", summary: "Leave requests addressed to me", permission: [P.LEAVE_APPROVE], query: myLeavesQuery, handler: c.approvals },
  { method: "post", path: "/approvals/:id/approve", summary: "Approve a request addressed to me", permission: P.LEAVE_APPROVE, params: idParams, body: decideLeaveSchema, handler: misc.approveLeave },
  { method: "post", path: "/approvals/:id/reject", summary: "Reject a request addressed to me", permission: P.LEAVE_APPROVE, params: idParams, body: decideLeaveSchema, handler: misc.rejectLeave },
]);
