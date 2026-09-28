import { z, objectId, dateKey, monthKey, hhmm, listQuery } from "./common.js";
import { RECORD_STATUS, LEAVE_STATUS, ATTENDANCE_STATUS } from "../constants/index.js";

export const departmentSchema = z.object({
  name: z.string().min(2).max(100), code: z.string().min(1).max(20),
  managerId: objectId.optional(), description: z.string().max(500).optional(), canApproveLeave: z.boolean().optional(), canAddEmployees: z.boolean().optional(), status: z.enum(Object.values(RECORD_STATUS)).optional(),
});
export const departmentUpdateSchema = departmentSchema.partial().strict();
export const departmentListQuery = listQuery.extend({ status: z.enum(Object.values(RECORD_STATUS)).optional() });

export const shiftSchema = z.object({
  name: z.string().min(2).max(100), startTime: hhmm, endTime: hhmm,
  breakDuration: z.number().int().min(0).max(480).default(0), gracePeriod: z.number().int().min(0).max(240).default(0),
  requiredWorkingMinutes: z.number().int().min(1).max(1440),
  allowOvertime: z.boolean().default(false), overtimeAfterMinutes: z.number().int().min(0).max(1440).optional(),
  status: z.enum(Object.values(RECORD_STATUS)).optional(),
}).refine((s) => s.startTime !== s.endTime, { message: "Start and end time cannot be equal", path: ["endTime"] });
export const shiftUpdateSchema = z.object({
  name: z.string().min(2).max(100), startTime: hhmm, endTime: hhmm, breakDuration: z.number().int().min(0).max(480), gracePeriod: z.number().int().min(0).max(240),
  requiredWorkingMinutes: z.number().int().min(1).max(1440), allowOvertime: z.boolean(), overtimeAfterMinutes: z.number().int().min(0).max(1440), status: z.enum(Object.values(RECORD_STATUS)),
}).partial().strict();

export const holidaySchema = z.object({ name: z.string().min(2).max(120), date: dateKey, description: z.string().max(300).optional(), recurring: z.boolean().default(false) });
export const holidayUpdateSchema = holidaySchema.partial().strict();
export const holidayListQuery = listQuery.extend({ year: z.coerce.number().int().min(2000).max(2100).optional() });

export const leaveTypeSchema = z.object({ name: z.string().min(2).max(80), code: z.string().min(1).max(10), annualQuota: z.number().min(0).max(366).default(12), isPaid: z.boolean().default(true), carryForward: z.boolean().default(false), isActive: z.boolean().default(true) });
export const leaveTypeUpdateSchema = leaveTypeSchema.partial().strict();

export const leaveRequestSchema = z.object({ employeeId: objectId, leaveTypeId: objectId, fromDate: dateKey, toDate: dateKey, isHalfDay: z.boolean().default(false), reason: z.string().max(500).optional() });
/** Either a range (`fromDate`..`toDate`) or separate days picked one by one (`dates`). */
export const applyLeaveSchema = z.object({
  leaveTypeId: objectId, fromDate: dateKey.optional(), toDate: dateKey.optional(), dates: z.array(dateKey).min(1).max(62).optional(),
  isHalfDay: z.boolean().default(false), reason: z.string().max(500).optional(), approverId: objectId.optional(), reportingToId: objectId.optional(),
}).strict()
  .refine((v) => Boolean(v.dates) !== Boolean(v.fromDate || v.toDate), { message: "Send either the days you picked or a from/to range", path: ["dates"] })
  .refine((v) => v.dates || (v.fromDate && v.toDate), { message: "Both from and to dates are required", path: ["toDate"] });
export const decideLeaveSchema = z.object({ note: z.string().max(300).optional() }).strict();
export const myAttendanceQuery = listQuery.extend({ from: dateKey.optional(), to: dateKey.optional() });
export const myLeavesQuery = listQuery.extend({ status: z.enum(Object.values(LEAVE_STATUS)).optional() });
export const leaveBalanceQuery = z.object({ employeeId: objectId, year: z.coerce.number().int().min(2000).max(2100).optional() });
export const leaveListQuery = listQuery.extend({ status: z.enum(Object.values(LEAVE_STATUS)).optional(), employeeId: objectId.optional(), from: dateKey.optional(), to: dateKey.optional() });


export const reportQuery = listQuery.extend({
  from: dateKey, to: dateKey, employeeId: objectId.optional(), department: objectId.optional(),
  status: z.enum([...Object.values(ATTENDANCE_STATUS), ...Object.values(LEAVE_STATUS)]).optional(),
  format: z.enum(["json", "csv"]).default("json"),
}).refine((v) => v.to >= v.from, { message: "'to' must be on or after 'from'", path: ["to"] });
export const salaryReportQuery = z.object({ month: monthKey, employeeId: objectId.optional(), department: objectId.optional(), format: z.enum(["json", "csv"]).default("json") });
export const notificationListQuery = listQuery.extend({ unread: z.enum(["true", "false"]).transform((v) => v === "true").optional() });
