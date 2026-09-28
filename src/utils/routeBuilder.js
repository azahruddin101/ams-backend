import { Router } from "express";
import { authenticate, authorize, requireTenant } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";

/** Every route registered through `defineRoutes` is also recorded here to generate the OpenAPI document. */
export const routeRegistry = [];

/**
 * @param {{prefix:string, tag:string}} cfg
 * @param {Array<{method:string, path:string, summary:string, description?:string, auth?:boolean, permission?:string|string[],
 *   tenant?:boolean, employee?:boolean, limiter?:Function, params?:object, query?:object, body?:object, handler:Function, csv?:boolean}>} defs
 */
export function defineRoutes({ prefix, tag }, defs) {
  const router = Router();
  for (const d of defs) {
    const auth = d.auth !== false;
    const chain = [];
    if (d.limiter) chain.push(d.limiter);
    if (auth) chain.push(authenticate);
    if (auth && d.tenant !== false && d.permission && !d.superAdminOnly) chain.push(requireTenant);
    if (d.permission) chain.push(authorize(...[].concat(d.permission)));
    if (d.params || d.query || d.body) chain.push(validate({ params: d.params, query: d.query, body: d.body }));
    router[d.method](d.path, ...chain, d.handler);
    routeRegistry.push({ ...d, tag, auth, fullPath: `${prefix}${d.path === "/" ? "" : d.path}` });
  }
  return router;
}
