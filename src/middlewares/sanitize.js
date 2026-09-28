/** Strips Mongo operator keys ($…) and dotted keys from body/params/query to block NoSQL injection. */
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("$") || k.includes(".")) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return value;
}

export function sanitize(req, _res, next) {
  if (req.body) req.body = clean(req.body);
  if (req.params) req.params = clean(req.params);
  const q = clean(req.query);
  Object.defineProperty(req, "query", { value: q, writable: true, configurable: true, enumerable: true });
  next();
}
