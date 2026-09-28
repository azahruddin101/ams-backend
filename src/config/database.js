import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";

mongoose.set("strictQuery", true);

let connecting = null;

/**
 * Connects once and reuses the connection. On a serverless host (Vercel) the same instance serves many requests, and
 * several may arrive before the first connection is up: they all wait for the same attempt instead of opening their own.
 */
export function connectDatabase(uri = env.MONGODB_URI) {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  connecting ??= mongoose
    .connect(uri, { autoIndex: !env.isProd, serverSelectionTimeoutMS: 8000 })
    .then(() => { logger.info({ msg: "MongoDB connected" }); })
    .finally(() => { connecting = null; }); // a failed attempt must not be remembered: the next request tries again
  return connecting;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export const isDatabaseReady = () => mongoose.connection.readyState === 1;
