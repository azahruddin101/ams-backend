import { z, objectId, dateKey, boolQuery, listQuery, hhmm } from "./common.js";
import { ATTENDANCE_STATUS, EVENT_TYPES, TIMING_MODES, LATE_PENALTIES, PENALTY_PERIODS, PENALTY_REPEAT, SALARY_DAY_BASIS } from "../constants/index.js";

const location = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).optional() });
export const faceInputSchema = z.object({ embedding: z.array(z.number().finite()).length(128) });
/** A device scan: the face template (never an image) plus, if the company enabled geofencing, the device's location. */
export const scanSchema = faceInputSchema.extend({ location: location.optional() });
export const manualEventSchema = z.object({
  employeeId: objectId,
  type: z.enum([EVENT_TYPES.MANUAL_CHECK_IN, EVENT_TYPES.MANUAL_CHECK_OUT]),
  timestamp: z.coerce.date(),
  reason: z.string().min(3).max(300),
});
export const voidEventSchema = z.object({ reason: z.string().min(3).max(300) });
export const recordListQuery = listQuery.extend({
  employeeId: objectId.optional(),
  department: objectId.optional(),
  date: dateKey.optional(),
  from: dateKey.optional(),
  to: dateKey.optional(),
  status: z.enum(Object.values(ATTENDANCE_STATUS)).optional(),
  late: boolQuery.optional(),
  halfDay: boolQuery.optional(),
});


const deductionDays = z.number().min(0).max(5); // days of salary
/** Rules that exist at company level and can be overridden per department. */
const ruleFields = {
  timingMode: z.enum(Object.values(TIMING_MODES)),
  expectedCheckInTime: hhmm, expectedCheckOutTime: hhmm,
  gracePeriod: z.number().int().min(0).max(240), lateAfterMinutes: z.number().int().min(0).max(600),
  halfDayAfterMinutes: z.number().int().min(0).max(1440), absentAfterMinutes: z.number().int().min(0).max(1440),
  minimumWorkingMinutes: z.number().int().min(0).max(1440), halfDayWorkingMinutes: z.number().int().min(0).max(1440),
  earlyCheckoutThreshold: z.number().int().min(0).max(600),
  overtimeEnabled: z.boolean(), overtimeAfterMinutes: z.number().int().min(0).max(1440),
  multipleCheckInAllowed: z.boolean(), multipleCheckOutAllowed: z.boolean(),
  lateCountEnabled: z.boolean(), lateCountThreshold: z.number().int().min(1).max(31),
  lateCountPeriod: z.enum(Object.values(PENALTY_PERIODS)), lateCountPenalty: z.enum(Object.values(LATE_PENALTIES)),
  lateStreakEnabled: z.boolean(), lateStreakThreshold: z.number().int().min(2).max(31), lateStreakPenalty: z.enum(Object.values(LATE_PENALTIES)),
  latePenaltyRepeat: z.enum(Object.values(PENALTY_REPEAT)),
  salaryDeductionEnabled: z.boolean(), salaryDayBasis: z.enum(Object.values(SALARY_DAY_BASIS)), salaryFixedDays: z.number().int().min(1).max(31),
  absentDeduction: deductionDays, halfDayDeduction: deductionDays, lateDeduction: deductionDays, unpaidLeaveDeduction: z.boolean(),
};
const timesDiffer = [(p) => !p.expectedCheckInTime || p.expectedCheckInTime !== p.expectedCheckOutTime, { message: "Start and end time cannot be equal", path: ["expectedCheckOutTime"] }];
export const updatePolicySchema = z.object({ ...ruleFields, geofenceEnabled: z.boolean(), geofenceRadius: z.number().min(10).max(50000) }).partial().strict().refine(...timesDiffer);
export const departmentPolicySchema = z.object(ruleFields).partial().strict().refine(...timesDiffer);
export const departmentIdParams = z.object({ departmentId: objectId });
export const employeeIdParams = z.object({ employeeId: objectId });
