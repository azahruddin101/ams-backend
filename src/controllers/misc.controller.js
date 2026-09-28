import * as leave from "../services/leave.service.js";
import * as reports from "../services/report.service.js";
import * as notif from "../services/notification.service.js";
import { companyDashboard, navCounts } from "../services/dashboard.service.js";
import { AuditLog } from "../models/index.js";
import { ok, created, paginated } from "../utils/response.js";
import { auditContext } from "../services/audit.service.js";
import { paginateQuery } from "../utils/pagination.js";

const cid = (req) => req.user.companyId;

/* leaves (recorded by the company for its employees) */
export const createLeave = async (req, res) => created(res, await leave.createLeave(auditContext(req), cid(req), req.validated.body), "Leave recorded");
export const listLeaves = async (req, res) => paginated(res, await leave.listLeaves(cid(req), req.validated.query));
export const leaveBalance = async (req, res) => ok(res, await leave.leaveBalance(cid(req), req.validated.query.employeeId, req.validated.query.year));
export const cancelLeave = async (req, res) => ok(res, await leave.cancelLeave(auditContext(req), cid(req), req.validated.params.id), "Leave cancelled");

const decide = (approve) => async (req, res) =>
  ok(res, await leave.decideLeave(auditContext(req), cid(req), req.validated.params.id, { approve, note: req.validated.body?.note }), approve ? "Leave approved" : "Leave rejected");
export const approveLeave = decide(true);
export const rejectLeave = decide(false);

/* reports */
const report = (fn, name = (q) => `report-${q.from}_${q.to}`) => async (req, res) => {
  const q = req.validated.query;
  const data = await fn(cid(req), q);
  if (q.format === "csv") {
    res.setHeader("Content-Type", reports.exporters.csv.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${name(q)}.csv"`);
    return res.send(reports.exporters.csv.render(data.items));
  }
  return paginated(res, data);
};
export const dailyReport = report(reports.dailyReport);
export const monthlyReport = report(reports.monthlyReport);
export const employeeReport = report(reports.employeeReport);
export const lateReport = report(reports.lateReport);
export const overtimeReport = report(reports.overtimeReport);
export const leaveReport = report(reports.leaveReport);
export const salaryReport = report(reports.salaryReport, (q) => `salary-${q.month}`);

/* dashboard / notifications / audit */
export const dashboard = async (req, res) => ok(res, await companyDashboard(cid(req), req.company));
export const menuCounts = async (req, res) => ok(res, await navCounts(req.user, req.company));
export const listNotifications = async (req, res) => {
  const [page, unread] = await Promise.all([notif.listNotifications(req.user.id, req.validated.query), notif.unreadCount(req.user.id)]);
  return res.json({ success: true, message: "Success", data: page.items, unreadCount: unread, pagination: { page: page.page, limit: page.limit, total: page.total, totalPages: Math.max(1, Math.ceil(page.total / page.limit)) } });
};
export const markRead = async (req, res) => ok(res, await notif.markRead(req.user.id, req.validated.params.id));
export const markAllRead = async (req, res) => { await notif.markAllRead(req.user.id); return ok(res, null, "All notifications marked read"); };
export const auditLogs = async (req, res) => paginated(res, await paginateQuery(AuditLog, { companyId: cid(req), ...(req.validated.query.search ? { action: new RegExp(`^${req.validated.query.search.replace(/[^\w.]/g, "")}`) } : {}) }, req.validated.query, { sortable: ["timestamp"], defaultSort: "timestamp" }));
