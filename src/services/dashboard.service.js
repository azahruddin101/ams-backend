import mongoose from "mongoose";
import { Employee, AttendanceRecord, LeaveRequest } from "../models/index.js";
import { EMPLOYEE_STATUS, LEAVE_STATUS, ATTENDANCE_STATUS } from "../constants/index.js";
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
