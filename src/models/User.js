import mongoose from "mongoose";
import { ROLES } from "../constants/index.js";
import { hideFields } from "./plugins.js";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ROLES), required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", default: null }, // set only for role EMPLOYEE
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    emailVerifiedAt: Date,
    failedLoginCount: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    passwordChangedAt: Date,
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.index({ companyId: 1, role: 1 });
userSchema.index({ employeeId: 1 }, { unique: true, partialFilterExpression: { employeeId: { $type: "objectId" } } }); // one login per employee
userSchema.pre("validate", function () {
  if (this.role === ROLES.SUPER_ADMIN) this.companyId = null;
  else if (!this.companyId) this.invalidate("companyId", "companyId is required for non super-admin users");
  if (this.role === ROLES.EMPLOYEE && !this.employeeId) this.invalidate("employeeId", "employeeId is required for employee logins");
  if (this.role !== ROLES.EMPLOYEE) this.employeeId = null;
});
userSchema.plugin(hideFields("passwordHash", "failedLoginCount", "lockedUntil", "passwordResetTokenHash", "passwordResetExpiresAt"));

export const User = mongoose.model("User", userSchema);
