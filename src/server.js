import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import app from "./app.js";
// SCHEDULER SWITCHED OFF: see the note at the bottom of jobs/index.js.
// import { startJobs } from "./jobs/index.js";
import "./models/index.js";

/** A normal, long-running server (local development, a VM, a container). */
async function main() {
  await connectDatabase();
  const server = app.listen(env.PORT, () => logger.info({ msg: `API listening on :${env.PORT}`, env: env.NODE_ENV }));
  // if (env.jobsEnabled) startJobs();

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

// On Vercel there is no port to listen on: the platform calls the exported app for each request.
if (!process.env.VERCEL) {
  main().catch((err) => {
    logger.fatal({ msg: "startup failed", err: err.message });
    process.exit(1);
  });
}

export default app;
