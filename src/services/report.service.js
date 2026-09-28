import mongoose from "mongoose";
import { AttendanceRecord, Company, Employee, LeaveRequest } from "../models/index.js";
import { ATTENDANCE_STATUS, SALARY_DAY_BASIS } from "../constants/index.js";
import { paginateQuery } from "../utils/pagination.js";
import { eachDateKey, monthRange, weekdayOfKey } from "../utils/time.js";
import { buildRecordFilter } from "./attendance.service.js";
import { holidayMap } from "./catalog.service.js";
import { getEffectivePolicy } from "./policy.service.js";

const oid = (v) => new mongoose.Types.ObjectId(v);
const EMP = { path: "employeeId", select: "firstName lastName employeeCode departmentId" };

async function scopedIds(companyId, q) {
  return q.department ? (await Employee.find({ companyId, departmentId: q.department }).select("_id").lean()).map((e) => e._id) : undefined;
}

const recordReport = (extra) => async (companyId, q) =>
  paginateQuery(AttendanceRecord, { ...buildRecordFilter(companyId, q, { employeeIds: await scopedIds(companyId, q) }), ...extra }, q, { sortable: ["date", "lateMinutes", "overtimeMinutes"], defaultSort: "date", populate: EMP });

export const dailyReport = recordReport({});
export const lateReport = recordReport({ isLate: true });
export const overtimeReport = recordReport({ isOvertime: true });

export async function employeeReport(companyId, q) {
  return paginateQuery(AttendanceRecord, buildRecordFilter(companyId, q), q, { sortable: ["date"], defaultSort: "date", populate: EMP });
}

/** One row per employee for the date range: the monthly attendance sheet. */
export async function monthlyReport(companyId, q) {
  const match = { companyId: oid(companyId), date: { $gte: q.from, $lte: q.to } };
  const ids = await scopedIds(companyId, q);
  if (q.employeeId) match.employeeId = oid(q.employeeId);
  else if (ids) match.employeeId = { $in: ids };
  const rows = await AttendanceRecord.aggregate([
    { $match: match },
    { $group: {
      _id: "$employeeId",
      present: { $sum: { $cond: [{ $in: ["$status", ["PRESENT", "LATE"]] }, 1, 0] } },
      absent: { $sum: { $cond: ["$isAbsent", 1, 0] } },
      halfDay: { $sum: { $cond: ["$isHalfDay", 1, 0] } },
      late: { $sum: { $cond: ["$isLate", 1, 0] } },
      onLeave: { $sum: { $cond: [{ $eq: ["$status", "ON_LEAVE"] }, 1, 0] } },
      incomplete: { $sum: { $cond: ["$isIncomplete", 1, 0] } },
      workingMinutes: { $sum: "$totalWorkingMinutes" },
      overtimeMinutes: { $sum: "$overtimeMinutes" },
    } },
    { $lookup: { from: "employees", localField: "_id", foreignField: "_id", as: "emp" } },
    { $unwind: "$emp" },
    { $project: { employeeId: "$_id", _id: 0, employeeCode: "$emp.employeeCode", name: { $concat: ["$emp.firstName", " ", "$emp.lastName"] }, present: 1, absent: 1, halfDay: 1, late: 1, onLeave: 1, incomplete: 1, workingMinutes: 1, overtimeMinutes: 1 } },
    { $sort: { employeeCode: 1 } },
  ]);
  return { items: rows, page: 1, limit: rows.length || 1, total: rows.length };
}

export async function leaveReport(companyId, q) {
  const filter = { companyId, status: q.status ?? { $ne: "CANCELLED" }, fromDate: { $lte: q.to }, toDate: { $gte: q.from } };
  if (q.employeeId) filter.employeeId = q.employeeId;
  const ids = await scopedIds(companyId, q);
  if (ids) filter.employeeId = q.employeeId ? { $in: ids.filter((i) => String(i) === q.employeeId) } : { $in: ids };
  return paginateQuery(LeaveRequest, filter, q, { sortable: ["fromDate", "status"], defaultSort: "fromDate", populate: [EMP, { path: "leaveTypeId", select: "name code isPaid" }] });
}

const money = (n) => Math.round(n * 100) / 100;

/**
 * Salary sheet for one month: each employee's salary, what their attendance costs them under the rules of THEIR department,
 * and what is left. Deductions are counted in days of salary; a day of salary follows the department's `salaryDayBasis`.
 */
export async function salaryReport(companyId, q) {
  const { from, to } = monthRange(Number(q.month.slice(0, 4)), Number(q.month.slice(5)));
  const filter = { companyId, dateOfJoining: { $lte: new Date(`${to}T23:59:59Z`) } };
  if (q.employeeId) filter._id = q.employeeId;
  if (q.department) filter.departmentId = q.department;
  const [company, employees, holidays] = await Promise.all([
    Company.findById(companyId).select("settings.weekOffDays currency").lean(),
    Employee.find(filter).select("firstName lastName employeeCode departmentId monthlySalary").populate({ path: "departmentId", select: "name" }).sort({ employeeCode: 1 }).lean(),
    holidayMap(companyId, from, to),
  ]);
  const records = await AttendanceRecord.find({ companyId, employeeId: { $in: employees.map((e) => e._id) }, date: { $gte: from, $lte: to } }).lean();
  const leaves = await LeaveRequest.find({ companyId, _id: { $in: records.map((r) => r.leaveRequestId).filter(Boolean) } }).select("isHalfDay").populate({ path: "leaveTypeId", select: "isPaid" }).lean();
  const unpaidLeave = new Map(leaves.filter((l) => l.leaveTypeId?.isPaid === false).map((l) => [String(l._id), l]));

  const isWorkingDay = (k) => !company.settings.weekOffDays.includes(weekdayOfKey(k)) && !holidays.has(k);
  const calendarDays = eachDateKey(from, to);
  const workingDays = calendarDays.filter(isWorkingDay).length;
  const daysInMonth = (p) => ({ [SALARY_DAY_BASIS.WORKING_DAYS]: workingDays, [SALARY_DAY_BASIS.FIXED_DAYS]: p.salaryFixedDays })[p.salaryDayBasis] || calendarDays.length;

  const policies = new Map(); // one lookup per department, not per employee
  const policyFor = (departmentId) => {
    const key = String(departmentId ?? "");
    if (!policies.has(key)) policies.set(key, getEffectivePolicy(companyId, departmentId));
    return policies.get(key);
  };
  const byEmployee = new Map();
  for (const r of records) byEmployee.set(String(r.employeeId), [...(byEmployee.get(String(r.employeeId)) ?? []), r]);

  const items = [];
  for (const e of employees) {
    const p = await policyFor(e.departmentId?._id);
    const row = { present: 0, late: 0, halfDay: 0, absent: 0, unpaidLeave: 0, latePenalties: 0, deductionDays: 0 };
    for (const r of byEmployee.get(String(e._id)) ?? []) {
      const leave = r.leaveRequestId && isWorkingDay(r.date) ? unpaidLeave.get(String(r.leaveRequestId)) : null;
      const leaveDays = leave ? (leave.isHalfDay ? 0.5 : r.status === ATTENDANCE_STATUS.ON_LEAVE ? 1 : 0) : 0;
      row.unpaidLeave += leaveDays;
      if (r.penaltyReason) row.latePenalties++;
      if (r.isLate) row.late++;
      if (r.status === ATTENDANCE_STATUS.ABSENT) row.absent++;
      else if (r.status === ATTENDANCE_STATUS.HALF_DAY) row.halfDay++;
      else if ([ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE].includes(r.status)) row.present++;
      if (!p.salaryDeductionEnabled) continue;
      if (r.status === ATTENDANCE_STATUS.ABSENT) row.deductionDays += p.absentDeduction;
      else if (r.status === ATTENDANCE_STATUS.HALF_DAY) row.deductionDays += p.halfDayDeduction;
      else if (r.status === ATTENDANCE_STATUS.LATE) row.deductionDays += p.lateDeduction;
      if (p.unpaidLeaveDeduction) row.deductionDays += leaveDays;
    }
    const monthlySalary = e.monthlySalary ?? 0;
    const perDay = monthlySalary / daysInMonth(p);
    const deductionAmount = Math.min(monthlySalary, money(row.deductionDays * perDay)); // never below zero
    items.push({
      employeeId: e._id, employeeCode: e.employeeCode, name: `${e.firstName} ${e.lastName}`, department: e.departmentId?.name ?? "",
      ...row, deductionDays: money(row.deductionDays), currency: company.currency, monthlySalary, perDaySalary: money(perDay), deductionAmount, netSalary: money(monthlySalary - deductionAmount),
    });
  }
  return { items, page: 1, limit: items.length || 1, total: items.length };
}

/* ------- export architecture: register new formats here ------- */
const csvCell = (v) => {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? (v instanceof Date ? v.toISOString() : JSON.stringify(v)) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const exporters = {
  csv: {
    contentType: "text/csv; charset=utf-8",
    render(rows) {
      const flat = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === "object" && v.firstName ? `${v.firstName} ${v.lastName}` : v?.name ?? v])));
      const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))].filter((c) => !["sessions", "__v"].includes(c));
      return [cols.join(","), ...flat.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
    },
  },
};
