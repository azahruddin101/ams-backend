import { AttendanceEvent, AttendanceRecord, Employee, Company, LeaveRequest } from "../../models/index.js";
import { LEAVE_STATUS, ATTENDANCE_STATUS, EMPLOYEE_STATUS } from "../../constants/index.js";
import { NotFoundError } from "../../utils/errors.js";
import { weekdayOfKey, dateKeyInTz, addDaysToKey } from "../../utils/time.js";
import { coversDate } from "../../utils/leave.js";
import { getEffectivePolicy } from "../policy.service.js";
import { holidayMap } from "../catalog.service.js";
import { calculateDay, applyLatePenalty, hasLatePenaltyRules, penaltyPeriodStart } from "./engine.js";

const NON_WORKING = [ATTENDANCE_STATUS.HOLIDAY, ATTENDANCE_STATUS.WEEK_OFF, ATTENDANCE_STATUS.ON_LEAVE];
const STREAK_LOOKBACK_DAYS = 45;
const CASCADE_DAYS = 31;

/** Everything the engine needs about an employee's tenant, in one place. The policy is the one for the employee's department. */
export async function loadEmployeeContext(companyId, employeeId) {
  const [employee, company] = await Promise.all([
    Employee.findOne({ _id: employeeId, companyId }).populate("shiftId").lean(),
    Company.findById(companyId).lean(),
  ]);
  if (!employee || !company) throw new NotFoundError("Employee not found");
  const policy = await getEffectivePolicy(companyId, employee.departmentId);
  return { employee, company, policy, shift: employee.shiftId ?? null, tz: company.timezone };
}

export async function dayTypeFor(company, companyId, dateKey) {
  const holidays = await holidayMap(companyId, dateKey, dateKey);
  if (holidays.has(dateKey)) return "HOLIDAY";
  return company.settings.weekOffDays.includes(weekdayOfKey(dateKey)) ? "WEEK_OFF" : "WORKDAY";
}

export async function approvedLeaveOn(companyId, employeeId, dateKey) {
  const leave = await LeaveRequest.findOne({ companyId, employeeId, status: LEAVE_STATUS.APPROVED, ...coversDate(dateKey) }).lean();
  if (!leave) return null;
  return { id: leave._id, isHalfDay: leave.isHalfDay };
}

/** Late days in the rule's period and in a row, both counting `dateKey` itself (which the caller knows is late). */
async function lateHistory(companyId, employeeId, dateKey, { company, policy }) {
  const base = { companyId, employeeId };
  const since = addDaysToKey(dateKey, -STREAK_LOOKBACK_DAYS);
  const [earlierInPeriod, previous, holidays] = await Promise.all([
    policy.lateCountEnabled ? AttendanceRecord.countDocuments({ ...base, isLate: true, date: { $gte: penaltyPeriodStart(dateKey, policy.lateCountPeriod), $lt: dateKey } }) : 0,
    policy.lateStreakEnabled ? AttendanceRecord.find({ ...base, date: { $gte: since, $lt: dateKey } }).select("date status isLate").lean() : [],
    policy.lateStreakEnabled ? holidayMap(companyId, since, dateKey) : new Map(),
  ]);
  // Walk back day by day: days off neither break nor extend a run, any other day that was not late ends it.
  const byDate = new Map(previous.map((r) => [r.date, r]));
  let streak = 1;
  for (let k = addDaysToKey(dateKey, -1); policy.lateStreakEnabled && k >= since; k = addDaysToKey(k, -1)) {
    const r = byDate.get(k);
    const dayOff = r ? NON_WORKING.includes(r.status) : holidays.has(k) || company.settings.weekOffDays.includes(weekdayOfKey(k));
    if (dayOff) continue;
    if (!r?.isLate) break;
    streak++;
  }
  return { lateCount: earlierInPeriod + 1, lateStreak: streak };
}

/**
 * Rebuilds the daily aggregate from the immutable event log (single source of truth).
 * Deletes the aggregate if the engine has nothing to say yet (e.g. today, no events).
 */
export async function recomputeDay(companyId, employeeId, dateKey, { context, now = new Date(), cascade = true } = {}) {
  context ??= await loadEmployeeContext(companyId, employeeId);
  const { company, policy, shift, tz } = context;
  const events = await AttendanceEvent.find({ companyId, employeeId, date: dateKey, voidedAt: null }).sort({ timestamp: 1, seq: 1 }).lean();
  const [dayType, leave] = await Promise.all([dayTypeFor(company, companyId, dateKey), approvedLeaveOn(companyId, employeeId, dateKey)]);

  const penalised = hasLatePenaltyRules(policy);
  const wasLate = penalised && cascade ? Boolean(await AttendanceRecord.exists({ companyId, employeeId, date: dateKey, isLate: true })) : false;
  const day = calculateDay({ dateKey, events, shift, policy, tz, dayType, leave, now });
  // A change in this day's lateness shifts the late count / run of the days after it (only possible when correcting the past).
  const after = () => (penalised && cascade && wasLate !== Boolean(day?.isLate) ? recomputeLateDaysAfter(companyId, employeeId, dateKey, context) : null);
  if (!day) {
    await AttendanceRecord.deleteOne({ companyId, employeeId, date: dateKey });
    await after();
    return null;
  }
  const result = applyLatePenalty(day, policy, penalised && day.isLate ? await lateHistory(companyId, employeeId, dateKey, context) : undefined);
  const status = leave?.isHalfDay && result.status === ATTENDANCE_STATUS.ABSENT && !events.length ? ATTENDANCE_STATUS.ON_LEAVE : result.status;
  const record = await AttendanceRecord.findOneAndUpdate(
    { companyId, employeeId, date: dateKey },
    { $set: { ...result, status, leaveRequestId: leave?.id ?? null } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  ).lean();
  await after();
  return record;
}

async function recomputeLateDaysAfter(companyId, employeeId, dateKey, context) {
  const later = await AttendanceRecord.find({ companyId, employeeId, isLate: true, date: { $gt: dateKey, $lte: addDaysToKey(dateKey, CASCADE_DAYS) } }).sort({ date: 1 }).select("date").lean();
  for (const r of later) await recomputeDay(companyId, employeeId, r.date, { context, cascade: false });
}

/** Recompute every active employee for a day (jobs, leave/holiday changes). */
export async function recomputeCompanyDay(companyId, dateKey, opts = {}) {
  const employees = await Employee.find({ companyId, status: EMPLOYEE_STATUS.ACTIVE, dateOfJoining: { $lte: new Date(`${dateKey}T23:59:59Z`) } }).select("_id").lean();
  let processed = 0;
  for (const e of employees) {
    await recomputeDay(companyId, e._id, dateKey, opts);
    processed++;
  }
  return processed;
}

export const recomputeRange = async (companyId, employeeId, from, to) => {
  const context = await loadEmployeeContext(companyId, employeeId);
  const today = dateKeyInTz(new Date(), context.tz);
  for (let k = from; k <= to && k <= today; k = addDaysToKey(k, 1)) await recomputeDay(companyId, employeeId, k, { context });
};
