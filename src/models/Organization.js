import mongoose from "mongoose";
import { EMPLOYEE_STATUS, RECORD_STATUS, TIMING_MODES, LATE_PENALTIES, PENALTY_PERIODS, PENALTY_REPEAT, SALARY_DAY_BASIS } from "../constants/index.js";
import { softDelete } from "./plugins.js";

const { Schema } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });
const companyRef = { type: Schema.Types.ObjectId, ref: "Company", required: true };

/* ---------- Department ---------- */
const departmentSchema = new Schema(
  {
    companyId: companyRef,
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    managerId: ref("Employee"),
    description: { type: String, maxlength: 500 },
    // authorities of the department's employees (used by their logins)
    canApproveLeave: { type: Boolean, default: false },
    canAddEmployees: { type: Boolean, default: false },
    status: { type: String, enum: Object.values(RECORD_STATUS), default: RECORD_STATUS.ACTIVE },
  },
  { timestamps: true }
);
departmentSchema.plugin(softDelete);
departmentSchema.index({ companyId: 1, code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

/* ---------- Shift ---------- */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const shiftSchema = new Schema(
  {
    companyId: companyRef,
    name: { type: String, required: true, trim: true, maxlength: 100 },
    startTime: { type: String, required: true, match: HHMM },
    endTime: { type: String, required: true, match: HHMM },
    breakDuration: { type: Number, default: 0, min: 0 },
    gracePeriod: { type: Number, default: 0, min: 0 },
    requiredWorkingMinutes: { type: Number, required: true, min: 1 },
    allowOvertime: { type: Boolean, default: false },
    overtimeAfterMinutes: { type: Number, min: 0 },
    status: { type: String, enum: Object.values(RECORD_STATUS), default: RECORD_STATUS.ACTIVE },
  },
  { timestamps: true }
);
shiftSchema.plugin(softDelete);
shiftSchema.index({ companyId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
shiftSchema.virtual("isOvernight").get(function () {
  return this.endTime <= this.startTime;
});

/* ---------- Employee ---------- */
const employeeSchema = new Schema(
  {
    companyId: companyRef,
    employeeCode: { type: String, required: true, trim: true, uppercase: true },
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: String,
    dateOfJoining: { type: Date, required: true },
    departmentId: ref("Department"),
    shiftId: ref("Shift"),
    designation: { type: String, trim: true },
    employmentType: { type: String, default: "FULL_TIME" },
    monthlySalary: { type: Number, min: 0 }, // in the company currency; required by the API on create
    status: { type: String, enum: Object.values(EMPLOYEE_STATUS), default: EMPLOYEE_STATUS.ACTIVE },
  },
  { timestamps: true }
);
employeeSchema.plugin(softDelete);
employeeSchema.index({ companyId: 1, email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
employeeSchema.index({ companyId: 1, employeeCode: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
employeeSchema.index({ companyId: 1, departmentId: 1, status: 1 });
employeeSchema.index({ companyId: 1, firstName: 1, lastName: 1 });

/* ---------- Attendance rules ---------- */
/** Rules a company sets as its default and may override per department (timing, in/out, late penalties, salary deduction). */
const ruleFields = {
  timingMode: { type: String, enum: Object.values(TIMING_MODES), default: TIMING_MODES.FIXED },
  expectedCheckInTime: { type: String, match: HHMM },
  expectedCheckOutTime: { type: String, match: HHMM },
  gracePeriod: { type: Number, default: 10, min: 0 },
  lateAfterMinutes: { type: Number, default: 0, min: 0 },
  halfDayAfterMinutes: { type: Number, default: 120, min: 0 },
  absentAfterMinutes: { type: Number, default: 240, min: 0 },
  minimumWorkingMinutes: { type: Number, default: 240, min: 0 },
  halfDayWorkingMinutes: { type: Number, default: 300, min: 0 },
  earlyCheckoutThreshold: { type: Number, default: 15, min: 0 },
  overtimeEnabled: { type: Boolean, default: true },
  overtimeAfterMinutes: { type: Number, default: 540, min: 0 },
  multipleCheckInAllowed: { type: Boolean, default: true },
  multipleCheckOutAllowed: { type: Boolean, default: true },
  // repeated lateness → the day is marked half day / absent
  lateCountEnabled: { type: Boolean, default: false },
  lateCountThreshold: { type: Number, default: 3, min: 1 },
  lateCountPeriod: { type: String, enum: Object.values(PENALTY_PERIODS), default: PENALTY_PERIODS.MONTH },
  lateCountPenalty: { type: String, enum: Object.values(LATE_PENALTIES), default: LATE_PENALTIES.HALF_DAY },
  lateStreakEnabled: { type: Boolean, default: false },
  lateStreakThreshold: { type: Number, default: 2, min: 2 },
  lateStreakPenalty: { type: String, enum: Object.values(LATE_PENALTIES), default: LATE_PENALTIES.HALF_DAY },
  latePenaltyRepeat: { type: String, enum: Object.values(PENALTY_REPEAT), default: PENALTY_REPEAT.NTH_ONWARDS },
  // salary deduction, in days of salary
  salaryDeductionEnabled: { type: Boolean, default: false },
  salaryDayBasis: { type: String, enum: Object.values(SALARY_DAY_BASIS), default: SALARY_DAY_BASIS.CALENDAR_DAYS },
  salaryFixedDays: { type: Number, default: 30, min: 1, max: 31 },
  absentDeduction: { type: Number, default: 1, min: 0 },
  halfDayDeduction: { type: Number, default: 0.5, min: 0 },
  lateDeduction: { type: Number, default: 0, min: 0 },
  unpaidLeaveDeduction: { type: Boolean, default: true },
};
export const RULE_KEYS = Object.freeze(Object.keys(ruleFields));

/** The company default (one per company). Geofencing is company-wide. */
const policySchema = new Schema(
  {
    companyId: { ...companyRef, unique: true },
    ...ruleFields,
    geofenceEnabled: { type: Boolean, default: false },
    geofenceRadius: { type: Number, default: 200, min: 1 },
    updatedBy: ref("User"),
  },
  { timestamps: true }
);

/** A department's own rules. No document = the department follows the company default. */
const departmentPolicySchema = new Schema(
  { companyId: companyRef, departmentId: { ...ref("Department"), required: true }, ...ruleFields, updatedBy: ref("User") },
  { timestamps: true }
);
departmentPolicySchema.index({ companyId: 1, departmentId: 1 }, { unique: true });

/* ---------- Holiday ---------- */
const holidaySchema = new Schema(
  {
    companyId: companyRef,
    name: { type: String, required: true, trim: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    description: String,
    recurring: { type: Boolean, default: false },
  },
  { timestamps: true }
);
holidaySchema.index({ companyId: 1, date: 1 }, { unique: true });

export const Department = mongoose.model("Department", departmentSchema);
export const Shift = mongoose.model("Shift", shiftSchema);
export const Employee = mongoose.model("Employee", employeeSchema);
export const AttendancePolicy = mongoose.model("AttendancePolicy", policySchema);
export const DepartmentPolicy = mongoose.model("DepartmentPolicy", departmentPolicySchema);
export const Holiday = mongoose.model("Holiday", holidaySchema);
