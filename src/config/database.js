import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";

mongoose.set("strictQuery", true);

export async function connectDatabase(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { autoIndex: !env.isProd, serverSelectionTimeoutMS: 8000 });
  logger.info({ msg: "MongoDB connected" });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export const isDatabaseReady = () => mongoose.connection.readyState === 1;
