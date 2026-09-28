import { z, email, password, listQuery } from "./common.js";
import { BRANDING, COMPANY_STATUS } from "../constants/index.js";

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour").transform((v) => v.toLowerCase());
/** Raster data-URI (png/jpeg/webp) or an https URL. Never SVG or other schemes. */
export const logoSchema = z.union([
  z.string().max(BRANDING.MAX_LOGO_CHARS, "Logo is too large").regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Logo must be a PNG, JPEG or WebP image"),
  z.string().max(500).url().refine((u) => u.startsWith("https://"), "Logo URL must use https"),
]);

const address = z.object({ line1: z.string(), line2: z.string(), city: z.string(), state: z.string(), country: z.string(), postalCode: z.string() }).partial();
const geofence = z.object({ enabled: z.boolean(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusMeters: z.number().min(10).max(50000) }).partial();
const settings = z.object({
  weekOffDays: z.array(z.number().int().min(0).max(6)).max(6),
  employmentTypes: z.array(z.string().min(2).max(40)).min(1).max(20),
  geofence,
}).partial().strict();

const base = {
  name: z.string().min(2).max(160),
  legalName: z.string().max(200).optional(),
  email,
  phone: z.string().max(30).optional(),
  address: address.optional(),
  timezone: z.string().min(1).default("Asia/Kolkata"),
  currency: z.string().length(3).default("INR"),
  logo: logoSchema.nullish(), // null clears it
  theme: z.object({ primaryColor: hexColor }).optional(),
};
export const createCompanySchema = z.object({
  ...base,
  status: z.enum(Object.values(COMPANY_STATUS)).default("TRIAL"),
  admin: z.object({ name: z.string().min(2), email, password }).optional(),
});
// No defaults here: a partial update must leave timezone/currency alone unless they are sent.
export const updateCompanySchema = z.object({ ...base, timezone: z.string().min(1), currency: z.string().length(3), status: z.never().optional(), settings: settings.optional() }).partial().strict();
export const deleteCompanySchema = z.object({ confirmName: z.string().min(1, "Type the company name to confirm") });
export const setStatusSchema = z.object({ status: z.enum(Object.values(COMPANY_STATUS)) });
export const createAdminSchema = z.object({ name: z.string().min(2), email, password });
export const companyListQuery = listQuery.extend({ status: z.enum(Object.values(COMPANY_STATUS)).optional() });
