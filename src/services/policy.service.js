import { AttendancePolicy, DepartmentPolicy, Department, RULE_KEYS } from "../models/index.js";
import { TIMING_MODES, LATE_PENALTIES, PENALTY_PERIODS, PENALTY_REPEAT, SALARY_DAY_BASIS } from "../constants/index.js";
import { NotFoundError } from "../utils/errors.js";
import { recordAudit } from "./audit.service.js";

export const defaultPolicy = () => ({
  timingMode: TIMING_MODES.FIXED,
  expectedCheckInTime: "09:00",
  expectedCheckOutTime: "18:00",
  gracePeriod: 10,
  lateAfterMinutes: 0,
  halfDayAfterMinutes: 120,
  absentAfterMinutes: 240,
  minimumWorkingMinutes: 240,
  halfDayWorkingMinutes: 300,
  earlyCheckoutThreshold: 15,
  overtimeEnabled: true,
  overtimeAfterMinutes: 540,
  multipleCheckInAllowed: true,
  multipleCheckOutAllowed: true,
  lateCountEnabled: false,
  lateCountThreshold: 3,
  lateCountPeriod: PENALTY_PERIODS.MONTH,
  lateCountPenalty: LATE_PENALTIES.HALF_DAY,
  lateStreakEnabled: false,
  lateStreakThreshold: 2,
  lateStreakPenalty: LATE_PENALTIES.HALF_DAY,
  latePenaltyRepeat: PENALTY_REPEAT.NTH_ONWARDS,
  salaryDeductionEnabled: false,
  salaryDayBasis: SALARY_DAY_BASIS.CALENDAR_DAYS,
  salaryFixedDays: 30,
  absentDeduction: 1,
  halfDayDeduction: 0.5,
  lateDeduction: 0,
  unpaidLeaveDeduction: true,
  geofenceEnabled: false,
  geofenceRadius: 200,
});

const pickRules = (src) => Object.fromEntries(RULE_KEYS.filter((k) => src[k] !== undefined && src[k] !== null).map((k) => [k, src[k]]));

/** The company default. Policies saved before a rule existed read as that rule's default. */
export async function getPolicy(companyId) {
  let policy = await AttendancePolicy.findOne({ companyId }).lean();
  if (!policy) policy = (await AttendancePolicy.create({ companyId, ...defaultPolicy() })).toObject();
  return { ...defaultPolicy(), ...policy };
}

export async function updatePolicy(ctx, companyId, patch) {
  const existing = await AttendancePolicy.findOne({ companyId });
  if (!existing) throw new NotFoundError("Attendance policy not found");
  const before = existing.toObject();
  Object.assign(existing, patch, { updatedBy: ctx.user.id });
  await existing.save();
  await recordAudit(ctx, { action: "attendance_policy.updated", entityType: "AttendancePolicy", entityId: existing._id, before, after: existing });
  return existing;
}

/** The rules that apply to an employee: the department's own rules if it has any, otherwise the company default. */
export async function getEffectivePolicy(companyId, departmentId) {
  const [company, own] = await Promise.all([
    getPolicy(companyId),
    departmentId ? DepartmentPolicy.findOne({ companyId, departmentId }).lean() : null,
  ]);
  return own ? { ...company, ...pickRules(own), departmentId: own.departmentId } : company;
}

async function departmentInTenant(companyId, departmentId) {
  const department = await Department.findOne({ _id: departmentId, companyId }).select("name code").lean();
  if (!department) throw new NotFoundError("Department not found");
  return department;
}

/** Every department with whether it follows the company default or has its own rules. */
export async function listDepartmentPolicies(companyId) {
  const [departments, own] = await Promise.all([
    Department.find({ companyId }).select("name code").sort({ name: 1 }).lean(),
    DepartmentPolicy.find({ companyId }).select("departmentId timingMode").lean(),
  ]);
  const byDept = new Map(own.map((p) => [String(p.departmentId), p]));
  return departments.map((d) => ({ ...d, hasOwnRules: byDept.has(String(d._id)), timingMode: byDept.get(String(d._id))?.timingMode ?? null }));
}

export async function getDepartmentPolicy(companyId, departmentId) {
  const department = await departmentInTenant(companyId, departmentId);
  const own = await DepartmentPolicy.exists({ companyId, departmentId });
  return { department, inherited: !own, policy: pickRules(await getEffectivePolicy(companyId, departmentId)) };
}

/** Gives the department its own rules. They start as a copy of the company default, so a partial update is complete. */
export async function setDepartmentPolicy(ctx, companyId, departmentId, patch) {
  const department = await departmentInTenant(companyId, departmentId);
  let doc = await DepartmentPolicy.findOne({ companyId, departmentId });
  const before = doc?.toObject() ?? null;
  doc ??= new DepartmentPolicy({ companyId, departmentId, ...pickRules(await getPolicy(companyId)) });
  Object.assign(doc, patch, { updatedBy: ctx.user.id });
  await doc.save();
  await recordAudit(ctx, { action: "department_policy.updated", entityType: "DepartmentPolicy", entityId: doc._id, before, after: doc, companyId });
  return { department, inherited: false, policy: pickRules(doc.toObject()) };
}

/** Back to the company default. */
export async function resetDepartmentPolicy(ctx, companyId, departmentId) {
  await departmentInTenant(companyId, departmentId);
  const doc = await DepartmentPolicy.findOneAndDelete({ companyId, departmentId });
  if (doc) await recordAudit(ctx, { action: "department_policy.reset", entityType: "DepartmentPolicy", entityId: doc._id, before: doc.toObject(), companyId });
  return getDepartmentPolicy(companyId, departmentId);
}
