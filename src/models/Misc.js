import mongoose from "mongoose";
import { LEAVE_STATUS, FACE_PROFILE_STATUS, NOTIFICATION_CHANNELS, SUBSCRIPTION_STATUS } from "../constants/index.js";
import { hideFields } from "./plugins.js";

const { Schema } = mongoose;
const companyRef = { type: Schema.Types.ObjectId, ref: "Company", required: true };
const employeeRef = { type: Schema.Types.ObjectId, ref: "Employee", required: true };
const DATE_KEY = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ };

const leaveTypeSchema = new Schema(
  {
    companyId: companyRef,
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    annualQuota: { type: Number, default: 12, min: 0 },
    isPaid: { type: Boolean, default: true },
    carryForward: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);
leaveTypeSchema.index({ companyId: 1, code: 1 }, { unique: true });

const leaveRequestSchema = new Schema(
  {
    companyId: companyRef,
    employeeId: employeeRef,
    leaveTypeId: { type: Schema.Types.ObjectId, ref: "LeaveType", required: true },
    fromDate: { ...DATE_KEY, required: true },
    toDate: { ...DATE_KEY, required: true },
    dates: { type: [DATE_KEY], default: undefined }, // separate days picked one by one; absent = the whole range
    days: { type: Number, required: true, min: 0.5 },
    isHalfDay: { type: Boolean, default: false },
    reason: { type: String, maxlength: 500 },
    status: { type: String, enum: Object.values(LEAVE_STATUS), default: LEAVE_STATUS.PENDING },
    approverId: { type: Schema.Types.ObjectId, ref: "Employee" }, // who the employee asked; empty = the company decides
    reportingToId: { type: Schema.Types.ObjectId, ref: "Employee" }, // who the employee reports to: kept informed, does not decide
    appliedBy: { type: Schema.Types.ObjectId, ref: "User" }, // set when the employee applied themselves
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
    decisionNote: String,
  },
  { timestamps: true }
);
leaveRequestSchema.index({ companyId: 1, employeeId: 1, status: 1 });
leaveRequestSchema.index({ companyId: 1, status: 1, fromDate: 1 });
leaveRequestSchema.index({ companyId: 1, fromDate: 1, toDate: 1 });
leaveRequestSchema.index({ companyId: 1, approverId: 1, status: 1 });

/** Encrypted embedding; never selected by default. */
const faceProfileSchema = new Schema(
  {
    companyId: companyRef,
    employeeId: employeeRef,
    provider: { type: String, required: true },
    modelVersion: String,
    embeddingCipher: { type: String, required: true, select: false },
    status: { type: String, enum: Object.values(FACE_PROFILE_STATUS), default: FACE_PROFILE_STATUS.ACTIVE },
    registeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    deactivatedAt: Date,
  },
  { timestamps: true }
);
faceProfileSchema.index({ companyId: 1, employeeId: 1, status: 1 });
faceProfileSchema.plugin(hideFields("embeddingCipher"));

const faceLogSchema = new Schema(
  {
    companyId: companyRef,
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee" }, // empty for unrecognised scans
    deviceUserId: { type: Schema.Types.ObjectId, ref: "User" }, // the attendance-device login that performed the scan
    action: { type: String, enum: ["REGISTER", "DEACTIVATE", "IDENTIFY"], required: true },
    success: Boolean,
    score: Number,
    reason: String,
    mode: String,
    provider: String,
    ipAddress: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
faceLogSchema.index({ companyId: 1, employeeId: 1, createdAt: -1 });
faceLogSchema.index({ companyId: 1, deviceUserId: 1, createdAt: -1 });

const notificationSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    channel: { type: String, enum: Object.values(NOTIFICATION_CHANNELS), default: NOTIFICATION_CHANNELS.IN_APP },
    title: { type: String, required: true },
    body: String,
    data: Schema.Types.Mixed,
    readAt: Date,
  },
  { timestamps: true }
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

const auditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: Schema.Types.ObjectId,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
auditSchema.index({ companyId: 1, timestamp: -1 });
auditSchema.index({ companyId: 1, entityType: 1, entityId: 1 });

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedByHash: String,
    userAgent: String,
    ipAddress: String,
  },
  { timestamps: true }
);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const subscriptionSchema = new Schema(
  {
    companyId: { ...companyRef, unique: true },
    plan: { type: String, default: "TRIAL" },
    status: { type: String, enum: Object.values(SUBSCRIPTION_STATUS), default: SUBSCRIPTION_STATUS.TRIAL },
    employeeLimit: { type: Number, default: 50 },
    currentPeriodEnd: Date,
  },
  { timestamps: true }
);

export const LeaveType = mongoose.model("LeaveType", leaveTypeSchema);
export const LeaveRequest = mongoose.model("LeaveRequest", leaveRequestSchema);
export const FaceProfile = mongoose.model("FaceProfile", faceProfileSchema);
export const FaceVerificationLog = mongoose.model("FaceVerificationLog", faceLogSchema);
export const Notification = mongoose.model("Notification", notificationSchema);
export const AuditLog = mongoose.model("AuditLog", auditSchema);
export const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
export const Subscription = mongoose.model("Subscription", subscriptionSchema);
