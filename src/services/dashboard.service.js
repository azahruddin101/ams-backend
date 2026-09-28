import mongoose from "mongoose";
import { Employee, AttendanceRecord, LeaveRequest, Company, Department, Shift, Holiday, LeaveType, User } from "../models/index.js";
import { EMPLOYEE_STATUS, LEAVE_STATUS, ATTENDANCE_STATUS, ROLES } from "../constants/index.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { coversDate } from "../utils/leave.js";
import { dateKeyInTz, addDaysToKey } from "../utils/time.js";

const DAYS_TREND = 7;

export async function companyDashboard(companyId, company) {
  const today = dateKeyInTz(new Date(), company.timezone);
  const cid = new mongoose.Types.ObjectId(companyId);
  const [totalEmployees, [t], onLeave, trend] = await Promise.all([
    Employee.countDocuments({ companyId, status: EMPLOYEE_STATUS.ACTIVE }),
    AttendanceRecord.aggregate([
      { $match: { companyId: cid, date: today } },
      { $group: {
        _id: null,
        present: { $sum: { $cond: [{ $in: ["$status", [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE, ATTENDANCE_STATUS.HALF_DAY, ATTENDANCE_STATUS.INCOMPLETE]] }, 1, 0] } },
        late: { $sum: { $cond: ["$isLate", 1, 0] } },
        incomplete: { $sum: { $cond: ["$isIncomplete", 1, 0] } },
        absentRecorded: { $sum: { $cond: ["$isAbsent", 1, 0] } },
        workingMinutes: { $sum: "$totalWorkingMinutes" },
        overtimeMinutes: { $sum: "$overtimeMinutes" },
      } },
    ]),
    LeaveRequest.countDocuments({ companyId, status: LEAVE_STATUS.APPROVED, ...coversDate(today) }),
    AttendanceRecord.aggregate([
      { $match: { companyId: cid, date: { $gte: addDaysToKey(today, -(DAYS_TREND - 1)), $lte: today } } },
      { $group: { _id: "$date", present: { $sum: { $cond: [{ $in: ["$status", ["PRESENT", "LATE", "HALF_DAY"]] }, 1, 0] } }, late: { $sum: { $cond: ["$isLate", 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const s = t ?? { present: 0, late: 0, incomplete: 0, absentRecorded: 0, workingMinutes: 0, overtimeMinutes: 0 };
  return {
    date: today, totalEmployees, presentToday: s.present, lateToday: s.late, onLeave,
    absentToday: Math.max(0, totalEmployees - s.present - onLeave), // not-yet-present counts as absent-so-far
    incompleteAttendance: s.incomplete, totalWorkingMinutes: s.workingMinutes, overtimeMinutes: s.overtimeMinutes,
    trend: trend.map((d) => ({ date: d._id, present: d.present, late: d.late })),
  };
}

/**
 * The numbers shown beside the menu entries. Each is counted only if the signed-in login may see that area, and always
 * inside its own company (or, for an employee's own entries, for that one employee).
 */
export async function navCounts(user, company) {
  const can = (p) => user.permissions.includes(p);
  const companyId = user.companyId;
  const wanted = {};
  if (can(P.COMPANY_MANAGE_ALL)) wanted.companies = Company.countDocuments({ deletedAt: null });
  if (companyId) {
    const today = dateKeyInTz(new Date(), company.timezone);
    if (can(P.EMPLOYEE_READ)) wanted.employees = Employee.countDocuments({ companyId });
    if (can(P.ATTENDANCE_READ)) wanted.attendance = AttendanceRecord.countDocuments({ companyId, date: today, status: { $in: [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE, ATTENDANCE_STATUS.HALF_DAY, ATTENDANCE_STATUS.INCOMPLETE] } });
    if (can(P.LEAVE_READ)) wanted.leaves = LeaveRequest.countDocuments({ companyId, status: LEAVE_STATUS.PENDING });
    if (can(P.DEPARTMENT_MANAGE)) wanted.departments = Department.countDocuments({ companyId });
    if (can(P.SHIFT_CREATE)) wanted.shifts = Shift.countDocuments({ companyId });
    if (can(P.HOLIDAY_READ)) wanted.holidays = Holiday.countDocuments({ companyId });
    if (can(P.LEAVE_TYPE_MANAGE)) wanted.leaveTypes = LeaveType.countDocuments({ companyId });
    if (can(P.DEVICE_MANAGE)) wanted.devices = User.countDocuments({ companyId, role: ROLES.ATTENDANCE_DEVICE });
    if (user.employeeId) {
      wanted.myLeaves = LeaveRequest.countDocuments({ companyId, employeeId: user.employeeId, status: LEAVE_STATUS.PENDING });
      if (can(P.LEAVE_APPROVE)) wanted.approvals = LeaveRequest.countDocuments({ companyId, approverId: user.employeeId, status: LEAVE_STATUS.PENDING });
    }
  }
  const keys = Object.keys(wanted);
  const values = await Promise.all(Object.values(wanted));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}
