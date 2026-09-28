import mongoose from "mongoose";
import { BRANDING, COMPANY_STATUS, TIME } from "../constants/index.js";

const { Schema } = mongoose;

const companySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    legalName: { type: String, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: String,
    address: { line1: String, line2: String, city: String, state: String, country: String, postalCode: String },
    timezone: { type: String, required: true, default: "UTC" },
    currency: { type: String, required: true, default: "INR", uppercase: true, minlength: 3, maxlength: 3 },
    logo: { type: String, maxlength: BRANDING.MAX_LOGO_CHARS }, // small raster data-URI or https URL (SVG is refused: it can carry scripts)
    theme: { primaryColor: { type: String, default: BRANDING.DEFAULT_COLOR, match: /^#[0-9a-f]{6}$/ } },
    status: { type: String, enum: Object.values(COMPANY_STATUS), default: COMPANY_STATUS.TRIAL, index: true },
    settings: {
      weekOffDays: { type: [Number], default: () => [...TIME.DEFAULT_WEEK_OFF] },
      employmentTypes: { type: [String], default: ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] },
      geofence: {
        enabled: { type: Boolean, default: false },
        latitude: Number,
        longitude: Number,
        radiusMeters: { type: Number, default: 200 },
      },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
companySchema.index({ name: 1 });
companySchema.index({ email: 1 });

export const Company = mongoose.model("Company", companySchema);
