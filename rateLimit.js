// In-memory per-IP rate limiter.
//
// Trade-off: state lives in the Lambda container and is wiped on cold start.
// Good enough to stop a single script from hammering the endpoint. Not good
// enough as a security boundary — see SPEC.md "Threat model."

const buckets = new Map();

const DEFAULT_LIMIT = 30;       // requests
const DEFAULT_WINDOW = 60_000;  // ms

function check(ip, limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW) {
  if (!ip) return { allowed: true, remaining: limit };  // no IP, no cap (shouldn't happen)
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = buckets.get(ip) || [];
  // Prune expired entries in place.
  let i = 0;
  while (i < bucket.length && bucket[i] < cutoff) i++;
  if (i > 0) bucket.splice(0, i);
  if (bucket.length >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket[0] + windowMs - now };
  }
  bucket.push(now);
  buckets.set(ip, bucket);
  return { allowed: true, remaining: limit - bucket.length };
}

module.exports = { check };
