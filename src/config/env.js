import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"), quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: z.string().default("false"),
  LOG_LEVEL: z.string().default("info"),
  BIOMETRIC_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex chars"),
  FACE_PROVIDER: z.string().default("mock"),
  FACE_MATCH_THRESHOLD: z.coerce.number().min(0.1).max(1.2).default(0.5),
  // 1:N identification at attendance devices is stricter than 1:1 because false-accept risk grows with the number of enrolled faces.
  FACE_IDENTIFY_THRESHOLD: z.coerce.number().min(0.1).max(1.2).default(0.45),
  FACE_AMBIGUITY_MARGIN: z.coerce.number().min(0).max(0.5).default(0.06),
  SCAN_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  FACE_LIVENESS_MODE: z.enum(["FACE_ONLY", "FACE_AND_LIVENESS"]).default("FACE_ONLY"),
  ENABLE_JOBS: z.string().default("true"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const e = parsed.data;
export const env = {
  ...e,
  isProd: e.NODE_ENV === "production",
  isTest: e.NODE_ENV === "test",
  corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  cookieSecure: e.COOKIE_SECURE === "true" || e.NODE_ENV === "production",
  jobsEnabled: e.ENABLE_JOBS === "true" && e.NODE_ENV !== "test",
};
