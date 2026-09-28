import { AttendanceRecord, Employee, FaceProfile } from "../models/index.js";
import { ATTENDANCE_STATUS, FACE_PROFILE_STATUS } from "../constants/index.js";
import { NotFoundError } from "../utils/errors.js";
import { paginateQuery } from "../utils/pagination.js";
import { dateKeyInTz } from "../utils/time.js";
import { getEffectivePolicy } from "./policy.service.js";

/** Everything here is scoped to ONE employee: the one the signed-in login belongs to. The id never comes from the client. */
export async function myProfile(companyId, employeeId, company) {
  const employee = await Employee.findOne({ _id: employeeId, companyId })
    .select("employeeCode firstName lastName email phone dateOfJoining designation employmentType monthlySalary status departmentId shiftId")
    .populate([{ path: "departmentId", select: "name code canApproveLeave canAddEmployees" }, { path: "shiftId", select: "name startTime endTime" }]).lean();
  if (!employee) throw new NotFoundError("Employee not found");

  const today = dateKeyInTz(new Date(), company.timezone);
  const [face, records, policy] = await Promise.all([
    FaceProfile.exists({ companyId, employeeId, status: FACE_PROFILE_STATUS.ACTIVE }),
    AttendanceRecord.find({ companyId, employeeId, date: { $gte: `${today.slice(0, 7)}-01`, $lte: today } }).select("-sessions").lean(),
    getEffectivePolicy(companyId, employee.departmentId?._id),
  ]);
  const count = (fn) => records.filter(fn).length;
  return {
    employee: { ...employee, faceRegistered: Boolean(face) },
    today: records.find((r) => r.date === today) ?? null,
    month: {
      from: `${today.slice(0, 7)}-01`, to: today,
      present: count((r) => [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE].includes(r.status)),
      late: count((r) => r.isLate), halfDay: count((r) => r.status === ATTENDANCE_STATUS.HALF_DAY), absent: count((r) => r.status === ATTENDANCE_STATUS.ABSENT),
      onLeave: count((r) => r.status === ATTENDANCE_STATUS.ON_LEAVE),
      workingMinutes: records.reduce((s, r) => s + (r.totalWorkingMinutes ?? 0), 0),
    },
    // the rules that apply to this person, so the dashboard can explain their day
    rules: { timingMode: policy.timingMode, expectedCheckInTime: employee.shiftId?.startTime ?? policy.expectedCheckInTime, expectedCheckOutTime: employee.shiftId?.endTime ?? policy.expectedCheckOutTime, gracePeriod: policy.gracePeriod, fullDayMinutes: policy.halfDayWorkingMinutes },
  };
}

export function myAttendance(companyId, employeeId, q) {
  const filter = { companyId, employeeId };
  if (q.from || q.to) filter.date = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  return paginateQuery(AttendanceRecord, filter, q, { sortable: ["date"], defaultSort: "date" });
}
