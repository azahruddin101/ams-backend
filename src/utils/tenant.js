import { ROLES } from "../constants/index.js";
import { AuthorizationError, BadRequestError } from "./errors.js";

/**
 * Resolve the tenant for a request. Regular users are always pinned to their own company.
 * Only SUPER_ADMIN may target another company, and must do so explicitly.
 */
export function resolveCompanyId(user, explicitCompanyId) {
  if (user.role === ROLES.SUPER_ADMIN) {
    if (!explicitCompanyId) throw new BadRequestError("companyId is required for super admin operations");
    return explicitCompanyId;
  }
  if (!user.companyId) throw new AuthorizationError("User is not associated with a company");
  return user.companyId;
}

/** Filter helper: always merges the authenticated tenant. Caller-supplied companyId is ignored. */
export const tenantFilter = (companyId, filter = {}) => ({ ...filter, companyId });
