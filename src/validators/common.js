import { z } from "zod";
import { paginationSchema } from "../utils/pagination.js";

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");
export const idParams = z.object({ id: objectId });
export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (24h)");
export const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");
export const password = z.string().min(10, "At least 10 characters").max(128).regex(/[a-z]/, "Needs a lowercase letter").regex(/[A-Z]/, "Needs an uppercase letter").regex(/\d/, "Needs a number");
export const email = z.email().transform((v) => v.toLowerCase().trim());
export const listQuery = paginationSchema;
export const dateRangeQuery = z.object({ from: dateKey, to: dateKey }).refine((v) => v.to >= v.from, { message: "'to' must be on or after 'from'", path: ["to"] });
export { z };
