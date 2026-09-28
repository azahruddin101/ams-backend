import { ValidationError } from "../utils/errors.js";

/** validate({ body, params, query }) → parsed values on req.validated (Express 5 req.query is read-only). */
export const validate = (schemas) => (req, _res, next) => {
  const validated = {};
  const errors = [];
  for (const part of ["params", "query", "body"]) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (result.success) validated[part] = result.data;
    else
      errors.push(...result.error.issues.map((i) => ({ location: part, field: i.path.join("."), message: i.message })));
  }
  if (errors.length) return next(new ValidationError("Validation failed", errors));
  req.validated = validated;
  next();
};
