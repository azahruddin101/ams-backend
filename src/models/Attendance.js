import mongoose from "mongoose";
import { ATTENDANCE_STATUS, EVENT_TYPES, EVENT_METHODS, PENALTY_REASONS } from "../constants/index.js";

const { Schema } = mongoose;
const companyRef = { type: Schema.Types.ObjectId, ref: "Company", required: true };
const employeeRef = { type: Schema.Types.ObjectId, ref: "Employee", required: true };

/** Append-only. Corrections are new events with `supersedes`/`voidedAt`, never edits. */
const eventSchema = new Schema(
  {
    companyId: companyRef,
    employeeId: employeeRef,
    date: { type: String, required: true }, // attendance day (shift-anchored, company tz)
    type: { type: String, enum: Object.values(EVENT_TYPES), required: true },
    timestamp: { type: Date, required: true },
    method: { type: String, enum: Object.values(EVENT_METHODS), default: EVENT_METHODS.WEB },
    deviceId: String,
    ipAddress: String,
    location: { latitude: Number, longitude: Number, accuracy: Number, distanceMeters: Number },
    seq: { type: Number, required: true },
    idempotencyKey: { type: String },
    deviceUserId: { type: Schema.Types.ObjectId, ref: "User" },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reason: String,
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    metadata: Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
eventSchema.index({ companyId: 1, employeeId: 1, timestamp: -1 });
eventSchema.index({ companyId: 1, employeeId: 1, date: 1 });
eventSchema.index({ companyId: 1, timestamp: -1 });
// Serialises concurrent writes per employee/day: two racing requests get the same seq and one fails.
eventSchema.index({ companyId: 1, employeeId: 1, date: 1, seq: 1 }, { unique: true });
eventSchema.index(
  { companyId: 1, employeeId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

const sessionSchema = new Schema(
  { checkIn: { type: Date, required: true }, checkOut: Date, durationMinutes: { type: Number, default: 0 } },
  { _id: false }
);

const recordSchema = new Schema(
  {
    companyId: companyRef,
    employeeId: employeeRef,
    date: { type: String, required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift" },
    sessions: [sessionSchema],
    firstCheckIn: Date,
    lastCheckOut: Date,
    totalWorkingMinutes: { type: Number, default: 0 },
    breakMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    lateMinutes: { type: Number, default: 0 },
    earlyCheckoutMinutes: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(ATTENDANCE_STATUS), required: true },
    isLate: { type: Boolean, default: false },
    isHalfDay: { type: Boolean, default: false },
    isAbsent: { type: Boolean, default: false },
    isOvertime: { type: Boolean, default: false },
    isIncomplete: { type: Boolean, default: false },
    isOpen: { type: Boolean, default: false },
    penaltyReason: { type: String, enum: [...Object.values(PENALTY_REASONS), null], default: null }, // why a late day was downgraded
    leaveRequestId: { type: Schema.Types.ObjectId, ref: "LeaveRequest" },
    isManuallyAdjusted: { type: Boolean, default: false },
    finalizedAt: Date,
  },
  { timestamps: true }
);
recordSchema.index({ companyId: 1, employeeId: 1, date: 1 }, { unique: true });
recordSchema.index({ companyId: 1, date: 1, status: 1 });

export const AttendanceEvent = mongoose.model("AttendanceEvent", eventSchema);
export const AttendanceRecord = mongoose.model("AttendanceRecord", recordSchema);
