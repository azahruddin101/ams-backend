import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import hpp from "hpp";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { connectDatabase, isDatabaseReady } from "./config/database.js";
import { buildOpenApiSpec } from "./config/swagger.js";
import { requestContext } from "./middlewares/requestContext.js";
import { sanitize } from "./middlewares/sanitize.js";
import { globalLimiter } from "./middlewares/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import api from "./routes/index.js";

// Development convenience only: the browser reaches the API through the Next.js proxy, so its Origin is whatever address the
// developer typed (localhost, or a LAN IP when testing on a phone). Production uses the explicit CORS_ORIGINS list alone.
const PRIVATE_NETWORK_ORIGIN = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)(:\d+)?$/;
const isAllowedOrigin = (origin) => env.corsOrigins.includes(origin) || (!env.isProd && PRIVATE_NETWORK_ORIGIN.test(origin));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.isProd ? 1 : false);

  app.use(requestContext);
  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => (!origin || isAllowedOrigin(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"))),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
  }));
  app.use(compression());
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
  app.use(cookieParser());
  app.use(sanitize);
  app.use(hpp());

  app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));
  app.get("/ready", (_req, res) => (isDatabaseReady() ? res.json({ status: "ready" }) : res.status(503).json({ status: "unavailable", reason: "database" })));

  const spec = buildOpenApiSpec();
  // Swagger UI needs inline scripts; relax CSP for the docs path only.
  app.use("/api/docs", (req, res, next) => { res.removeHeader("Content-Security-Policy"); next(); }, swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: "AMS API Docs" }));
  app.get("/api/docs.json", (_req, res) => res.json(spec));

  // A normal server connects before it starts listening, so this does nothing there. A serverless instance (Vercel) has
  // no start-up step: the first request makes the connection, later ones reuse it.
  const database = (_req, res, next) => (isDatabaseReady() ? next() : connectDatabase().then(() => next(), () => res.status(503).json({ success: false, message: "The service is starting or the database is unreachable. Please try again.", code: "DATABASE_UNAVAILABLE", errors: [] })));
  app.use("/api/v1", database, globalLimiter, api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/**
 * The application itself. Vercel runs an Express project with no configuration: it looks for src/app.js or src/server.js
 * and uses the default export, calling it once per request. Both files export this same instance, so either works.
 */
const app = createApp();
export default app;
