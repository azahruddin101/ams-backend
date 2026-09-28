import { defineRoutes } from "../utils/routeBuilder.js";
import * as c from "../controllers/company.controller.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { createCompanySchema, updateCompanySchema, setStatusSchema, deleteCompanySchema, createAdminSchema, companyListQuery } from "../validators/company.js";
import { idParams } from "../validators/common.js";

const SA = { permission: P.COMPANY_MANAGE_ALL, superAdminOnly: true };

export default defineRoutes({ prefix: "/companies", tag: "Companies" }, [
  { method: "get", path: "/", summary: "List companies (super admin)", ...SA, query: companyListQuery, handler: c.list },
  { method: "post", path: "/", summary: "Create a company, optionally with its first admin (super admin)", ...SA, body: createCompanySchema, handler: c.create },
  { method: "get", path: "/stats", summary: "Platform-level metrics (super admin)", ...SA, handler: c.stats },
  { method: "get", path: "/me", summary: "Get my company", permission: P.COMPANY_READ, handler: c.getMine },
  { method: "patch", path: "/me", summary: "Update my company (timezone, currency, geofence, settings)", permission: P.COMPANY_UPDATE, body: updateCompanySchema, handler: c.updateMine },
  { method: "get", path: "/:id", summary: "Get a company (super admin)", ...SA, params: idParams, handler: c.get },
  { method: "patch", path: "/:id", summary: "Update a company (super admin)", ...SA, params: idParams, body: updateCompanySchema, handler: c.update },
  { method: "delete", path: "/:id", summary: "PERMANENTLY delete a company and all its data (super admin; body must repeat the company name)", ...SA, params: idParams, body: deleteCompanySchema, handler: c.remove },
  { method: "patch", path: "/:id/status", summary: "Suspend / activate a company (super admin)", ...SA, params: idParams, body: setStatusSchema, handler: c.setStatus },
  { method: "post", path: "/:id/admins", summary: "Create a company admin (super admin)", ...SA, params: idParams, body: createAdminSchema, handler: c.createAdmin },
]);
