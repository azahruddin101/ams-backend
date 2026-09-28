import { LeaveRequest, LeaveType, Employee, Company, Department, User } from "../models/index.js";
import { LEAVE_STATUS, EMPLOYEE_STATUS, ROLES } from "../constants/index.js";
import { AuthorizationError, BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { notify } from "./notification.service.js";
import { eachDateKey, weekdayOfKey } from "../utils/time.js";
import { leaveDates } from "../utils/leave.js";
import { paginateQuery } from "../utils/pagination.js";
import { holidayMap } from "./catalog.service.js";
import { recordAudit } from "./audit.service.js";
import { loadEmployeeContext, recomputeDay } from "./attendance/recompute.js";

const MAX_LEAVE_SPAN_DAYS = 366;
const MAX_PICKED_DAYS = 62;

/** Leave days exclude company week-offs and holidays. */
export async function countLeaveDays(companyId, from, to, isHalfDay = false, dates = null) {
  const company = await Company.findById(companyId).select("settings.weekOffDays").lean();
  const holidays = await holidayMap(companyId, from, to);
  const days = (dates ?? eachDateKey(from, to)).filter((k) => !company.settings.weekOffDays.includes(weekdayOfKey(k)) && !holidays.has(k)).length;
  return isHalfDay ? Math.min(days, 1) * 0.5 : days;
}

export async function leaveBalance(companyId, employeeId, year = new Date().getUTCFullYear()) {
  const [types, requests] = await Promise.all([
    LeaveType.find({ companyId, isActive: true }).lean(),
    LeaveRequest.find({ companyId, employeeId, status: { $in: [LEAVE_STATUS.APPROVED, LEAVE_STATUS.PENDING] }, fromDate: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).lean(),
  ]);
  return types.map((t) => {
    const mine = requests.filter((r) => String(r.leaveTypeId) === String(t._id));
    const used = mine.filter((r) => r.status === LEAVE_STATUS.APPROVED).reduce((s, r) => s + r.days, 0);
    const pending = mine.filter((r) => r.status === LEAVE_STATUS.PENDING).reduce((s, r) => s + r.days, 0);
    return { leaveTypeId: t._id, name: t.name, code: t.code, isPaid: t.isPaid, quota: t.annualQuota, used, pending, remaining: t.annualQuota - used - pending };
  });
}

const PEOPLE = [
  { path: "employeeId", select: "firstName lastName employeeCode departmentId" },
  { path: "approverId", select: "firstName lastName employeeCode" },
  { path: "reportingToId", select: "firstName lastName employeeCode", populate: { path: "departmentId", select: "name" } },
  { path: "leaveTypeId", select: "name code isPaid" },
];
const span = (r) => (r.dates?.length ? r.dates.join(", ") : r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`);

/** Separate days, tidied: sorted, no repeats, with the range they span. */
function normaliseDates(input) {
  if (!input.dates) return input;
  const dates = [...new Set(input.dates)].sort();
  return { ...input, dates, fromDate: dates[0], toDate: dates.at(-1) };
}

/** Checks shared by recording and applying. Pending requests hold their dates and balance until they are decided. */
async function validateLeave(companyId, { employeeId, leaveTypeId, fromDate, toDate, isHalfDay, dates }) {
  if (!(await Employee.exists({ _id: employeeId, companyId }))) throw new NotFoundError("Employee not found");
  if (toDate < fromDate) throw new BadRequestError("End date cannot be before start date");
  if (isHalfDay && fromDate !== toDate) throw new BadRequestError("Half-day leave must be a single day");
  if (dates?.length > MAX_PICKED_DAYS) throw new BadRequestError("Too many days in one request");
  if (eachDateKey(fromDate, toDate).length > MAX_LEAVE_SPAN_DAYS) throw new BadRequestError("Leave range is too long");
  const type = await LeaveType.findOne({ _id: leaveTypeId, companyId, isActive: true });
  if (!type) throw new BadRequestError("Leave type not found");

  // Ranges may interleave when days were picked one by one (28, 29 and 3 leaves the days between free), so compare day by day.
  const wanted = new Set(dates ?? eachDateKey(fromDate, toDate));
  const nearby = await LeaveRequest.find({ companyId, employeeId, status: { $in: [LEAVE_STATUS.APPROVED, LEAVE_STATUS.PENDING] }, fromDate: { $lte: toDate }, toDate: { $gte: fromDate } }).select("fromDate toDate dates").lean();
  const overlap = nearby.some((r) => leaveDates(r).some((d) => wanted.has(d)));
  if (overlap) throw new ConflictError("There is already leave (recorded or awaiting approval) overlapping these dates", "LEAVE_OVERLAP");

  const days = await countLeaveDays(companyId, fromDate, toDate, isHalfDay, dates);
  if (dates && !isHalfDay && days < dates.length) throw new BadRequestError("Some of the days you picked are days off or holidays", "NOT_A_WORKING_DAY");
  if (days <= 0) throw new BadRequestError("Selected dates contain no working days");
  const balance = (await leaveBalance(companyId, employeeId, Number(fromDate.slice(0, 4)))).find((b) => String(b.leaveTypeId) === String(type._id));
  if (balance && days > balance.remaining) throw new BadRequestError(`Insufficient ${type.name} balance (${balance.remaining} day(s) left)`, "INSUFFICIENT_BALANCE");
  return { days, type };
}

/** The company records leave for an employee. It is approved immediately and updates attendance. */
export async function createLeave(ctx, companyId, input) {
  const { employeeId, leaveTypeId, fromDate, toDate, isHalfDay, reason } = input;
  const { days } = await validateLeave(companyId, input);
  const req = await LeaveRequest.create({
    companyId, employeeId, leaveTypeId, fromDate, toDate, days, isHalfDay: Boolean(isHalfDay), reason,
    status: LEAVE_STATUS.APPROVED, decidedBy: ctx.user.id, decidedAt: new Date(),
  });
  await refreshAttendance(companyId, req);
  await recordAudit(ctx, { action: "leave.recorded", entityType: "LeaveRequest", entityId: req._id, after: req, companyId });
  return req;
}

/* ---------- employees applying, and the people who decide ---------- */
const loginsOf = (companyId, employeeIds) => User.find({ companyId, role: ROLES.EMPLOYEE, isActive: true, employeeId: { $in: employeeIds } }).select("_id employeeId").lean();

/** Who an employee may ask: active employees of departments that approve leave, who can sign in to do so. Never oneself. */
export async function listApprovers(companyId, forEmployeeId) {
  const departments = await Department.find({ companyId, canApproveLeave: true }).select("name").lean();
  if (!departments.length) return [];
  const names = new Map(departments.map((d) => [String(d._id), d.name]));
  const people = await Employee.find({ companyId, status: EMPLOYEE_STATUS.ACTIVE, departmentId: { $in: departments.map((d) => d._id) }, _id: { $ne: forEmployeeId } })
    .select("firstName lastName employeeCode designation departmentId").sort({ firstName: 1, lastName: 1 }).lean();
  const canSignIn = new Set((await loginsOf(companyId, people.map((p) => p._id))).map((u) => String(u.employeeId)));
  return people.filter((p) => canSignIn.has(String(p._id))).map((p) => ({ _id: p._id, name: `${p.firstName} ${p.lastName}`, employeeCode: p.employeeCode, designation: p.designation, department: names.get(String(p.departmentId)) }));
}

/** Everyone an employee could report to: active colleagues with their department. Names only — nothing private. */
export async function listColleagues(companyId, forEmployeeId) {
  const people = await Employee.find({ companyId, status: EMPLOYEE_STATUS.ACTIVE, _id: { $ne: forEmployeeId } })
    .select("firstName lastName employeeCode designation departmentId").populate("departmentId", "name").sort({ firstName: 1, lastName: 1 }).lean();
  return people.map((p) => ({ _id: p._id, name: `${p.firstName} ${p.lastName}`, employeeCode: p.employeeCode, designation: p.designation, departmentId: p.departmentId?._id ?? null, department: p.departmentId?.name ?? null }));
}

/** What the "apply for leave" form needs, in one request: leave types with balance, people, and the days that are off. */
export async function leaveOptions(companyId, employeeId, today) {
  const year = Number(today.slice(0, 4));
  const [company, types, balance, approvers, colleagues, holidays] = await Promise.all([
    Company.findById(companyId).select("settings.weekOffDays").lean(),
    LeaveType.find({ companyId, isActive: true }).select("name code isPaid").sort({ name: 1 }).lean(),
    leaveBalance(companyId, employeeId, year),
    listApprovers(companyId, employeeId),
    listColleagues(companyId, employeeId),
    holidayMap(companyId, `${year - 1}-01-01`, `${year + 1}-12-31`),
  ]);
  const remaining = new Map(balance.map((b) => [String(b.leaveTypeId), b.remaining]));
  return {
    today,
    types: types.map((t) => ({ ...t, remaining: remaining.get(String(t._id)) ?? null })),
    approvers, colleagues,
    weekOffDays: company.settings.weekOffDays,
    holidays: [...holidays].map(([date, h]) => ({ date, name: h.name })),
  };
}

/** An employee asks for leave. It waits (PENDING) for the person they chose; with nobody to choose, the company decides. */
export async function applyLeave(ctx, companyId, employeeId, { approverId, reportingToId, ...raw }) {
  const input = normaliseDates(raw);
  if (reportingToId && (reportingToId === String(employeeId) || !(await Employee.exists({ _id: reportingToId, companyId, status: EMPLOYEE_STATUS.ACTIVE })))) {
    throw new BadRequestError("Choose a colleague you report to", "INVALID_REPORTING_EMPLOYEE");
  }
  const approvers = await listApprovers(companyId, employeeId);
  if (approvers.length && !approverId) throw new BadRequestError("Choose who should approve this leave", "APPROVER_REQUIRED");
  if (approverId && !approvers.some((a) => String(a._id) === approverId)) throw new BadRequestError("That person cannot approve leave", "INVALID_APPROVER");
  const { days, type } = await validateLeave(companyId, { ...input, employeeId });
  const req = await LeaveRequest.create({ ...input, companyId, employeeId, days, isHalfDay: Boolean(input.isHalfDay), status: LEAVE_STATUS.PENDING, approverId: approverId ?? null, reportingToId: reportingToId ?? null, appliedBy: ctx.user.id });

  const deciders = approverId
    ? await User.find({ companyId, role: ROLES.EMPLOYEE, employeeId: approverId, isActive: true }).select("_id").lean()
    : await User.find({ companyId, role: ROLES.COMPANY, isActive: true }).select("_id").lean();
  for (const u of deciders) await notify({ companyId, userId: u._id, title: "Leave request to approve", body: `${ctx.user.name} asked for ${type.name}: ${span(req)} (${days} day${days === 1 ? "" : "s"}).`, data: { leaveRequestId: req._id } });
  if (reportingToId && reportingToId !== approverId) {
    for (const u of await loginsOf(companyId, [reportingToId])) await notify({ companyId, userId: u._id, title: "Leave request from your team", body: `${ctx.user.name} asked for ${type.name}: ${span(req)} (${days} day${days === 1 ? "" : "s"}). You are informed; the approver decides.`, data: { leaveRequestId: req._id } });
  }
  await recordAudit(ctx, { action: "leave.applied", entityType: "LeaveRequest", entityId: req._id, after: req, companyId });
  return req;
}

/**
 * Approve or reject a pending request. The company may decide any; an employee only the ones addressed to them.
 * Approval is when the leave starts to count in attendance.
 */
export async function decideLeave(ctx, companyId, id, { approve, note }) {
  const filter = { _id: id, companyId };
  if (ctx.user.role === ROLES.EMPLOYEE) filter.approverId = ctx.user.employeeId; // someone else's request simply does not exist for them
  const req = await LeaveRequest.findOne(filter);
  if (!req) throw new NotFoundError("Leave request not found");
  if (String(req.employeeId) === ctx.user.employeeId) throw new AuthorizationError("You cannot decide your own leave");
  if (req.status !== LEAVE_STATUS.PENDING) throw new ConflictError("This request has already been decided", "INVALID_STATE");

  Object.assign(req, { status: approve ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.REJECTED, decidedBy: ctx.user.id, decidedAt: new Date(), decisionNote: note });
  await req.save();
  if (approve) await refreshAttendance(companyId, req);
  const applicant = await User.findOne({ companyId, role: ROLES.EMPLOYEE, employeeId: req.employeeId }).select("_id").lean();
  if (applicant) await notify({ companyId, userId: applicant._id, title: approve ? "Leave approved" : "Leave rejected", body: `Your leave for ${span(req)} was ${approve ? "approved" : "rejected"} by ${ctx.user.name}.${note ? ` Note: ${note}` : ""}`, data: { leaveRequestId: req._id } });
  if (req.reportingToId && String(req.reportingToId) !== ctx.user.employeeId) {
    const who = await Employee.findById(req.employeeId).select("firstName lastName").lean();
    for (const u of await loginsOf(companyId, [req.reportingToId])) await notify({ companyId, userId: u._id, title: approve ? "Team leave approved" : "Team leave rejected", body: `${who.firstName} ${who.lastName}'s leave for ${span(req)} was ${approve ? "approved" : "rejected"}.`, data: { leaveRequestId: req._id } });
  }
  await recordAudit(ctx, { action: approve ? "leave.approved" : "leave.rejected", entityType: "LeaveRequest", entityId: req._id, after: { status: req.status, note }, companyId });
  return req;
}

/** An employee takes back their own request before it is decided. */
export async function withdrawLeave(ctx, companyId, employeeId, id) {
  const req = await LeaveRequest.findOne({ _id: id, companyId, employeeId });
  if (!req) throw new NotFoundError("Leave request not found");
  if (req.status !== LEAVE_STATUS.PENDING) throw new ConflictError("Only a request that is still waiting can be withdrawn. Ask your company to cancel approved leave.", "INVALID_STATE");
  req.status = LEAVE_STATUS.CANCELLED;
  await req.save();
  await recordAudit(ctx, { action: "leave.withdrawn", entityType: "LeaveRequest", entityId: req._id, companyId });
  return req;
}

/** Requests addressed to this employee. */
export const listApprovals = (companyId, approverId, q) =>
  paginateQuery(LeaveRequest, { companyId, approverId, ...(q.status ? { status: q.status } : {}) }, q, { sortable: ["createdAt", "fromDate"], populate: PEOPLE });

async function refreshAttendance(companyId, req) {
  const context = await loadEmployeeContext(companyId, req.employeeId);
  for (const k of eachDateKey(req.fromDate, req.toDate)) await recomputeDay(companyId, req.employeeId, k, { context });
}

export async function cancelLeave(ctx, companyId, id) {
  const req = await LeaveRequest.findOne({ _id: id, companyId });
  if (!req) throw new NotFoundError("Leave not found");
  if (req.status !== LEAVE_STATUS.APPROVED) throw new ConflictError("Only recorded leave can be cancelled", "INVALID_STATE");
  req.status = LEAVE_STATUS.CANCELLED;
  await req.save();
  await refreshAttendance(companyId, req);
  await recordAudit(ctx, { action: "leave.cancelled", entityType: "LeaveRequest", entityId: req._id, companyId });
  return req;
}

export async function listLeaves(companyId, q) {
  const filter = { companyId };
  if (q.employeeId) filter.employeeId = q.employeeId;
  if (q.status) filter.status = q.status;
  if (q.from || q.to) {
    if (q.to) filter.fromDate = { $lte: q.to };
    if (q.from) filter.toDate = { $gte: q.from };
  }
  return paginateQuery(LeaveRequest, filter, q, {
    sortable: ["createdAt", "fromDate", "status"],
    populate: PEOPLE,
  });
}
