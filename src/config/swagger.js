import { z } from "zod";
import { routeRegistry } from "../utils/routeBuilder.js";
import "../routes/index.js"; // ensure all routes are registered

const toSchema = (zod) => {
  const { $schema: _s, ...schema } = z.toJSONSchema(zod, { io: "input", unrepresentable: "any", target: "draft-7" });
  return schema;
};

const errorRef = (description) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

function parametersFrom(zod, location) {
  if (!zod) return [];
  const schema = toSchema(zod);
  return Object.entries(schema.properties ?? {}).map(([name, s]) => ({
    name, in: location, required: location === "path" || (schema.required ?? []).includes(name), schema: s,
  }));
}

export function buildOpenApiSpec() {
  const paths = {};
  for (const r of routeRegistry) {
    const p = r.fullPath.replace(/:([A-Za-z]+)/g, "{$1}");
    const parameters = [...parametersFrom(r.params, "path"), ...parametersFrom(r.query, "query")];
    const op = {
      tags: [r.tag],
      summary: r.summary,
      ...(r.description ? { description: r.description } : {}),
      ...(r.auth ? { security: [{ bearerAuth: [] }] } : { security: [] }),
      ...(r.permission ? { "x-required-permission": [].concat(r.permission) } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: toSchema(r.body) } } } } : {}),
      responses: {
        200: { description: "Success", content: { "application/json": { schema: { $ref: "#/components/schemas/Success" } } } },
        ...(r.body || r.query || r.params ? { 422: errorRef("Validation failed") } : {}),
        ...(r.auth ? { 401: errorRef("Authentication required"), 403: errorRef("Permission denied / tenant mismatch") } : { 401: errorRef("Invalid credentials") }),
        404: errorRef("Not found"),
        429: errorRef("Rate limited"),
      },
    };
    (paths[p] ??= {})[r.method] = op;
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Attendance Management SaaS API",
      version: "1.0.0",
      description: "Multi-tenant attendance API. The tenant is always derived from the access token; companyId is never accepted from clients (except super-admin company routes). Refresh tokens live in an httpOnly cookie (`ams_rt`).",
    },
    servers: [{ url: "/api/v1" }],
    tags: [...new Set(routeRegistry.map((r) => r.tag))].map((name) => ({ name })),
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        Success: { type: "object", properties: { success: { type: "boolean", example: true }, message: { type: "string" }, data: {}, pagination: { $ref: "#/components/schemas/Pagination" } } },
        Pagination: { type: "object", properties: { page: { type: "integer" }, limit: { type: "integer", maximum: 100 }, total: { type: "integer" }, totalPages: { type: "integer" } } },
        Error: { type: "object", properties: { success: { type: "boolean", example: false }, message: { type: "string" }, code: { type: "string" }, errors: { type: "array", items: { type: "object", properties: { location: { type: "string" }, field: { type: "string" }, message: { type: "string" } } } } } },
      },
    },
    paths,
  };
}
