import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { createApp } from "./app.js";
import { startJobs } from "./jobs/index.js";
import "./models/index.js";

async function main() {
  await connectDatabase();
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info({ msg: `API listening on :${env.PORT}`, env: env.NODE_ENV }));
  if (env.jobsEnabled) startJobs();

  const shutdown = async (signal) => {
    logger.info({ msg: `${signal} received, shutting down` });
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => logger.error({ msg: "unhandledRejection", err: String(err) }));
}

main().catch((err) => {
  logger.fatal({ msg: "startup failed", err: err.message });
  process.exit(1);
});
