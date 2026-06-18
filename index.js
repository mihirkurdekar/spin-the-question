// Lambda Function URL handler.
//
// Routing, HMAC session token, Origin check, per-IP rate limit, body size cap,
// CORS, structured logging. Calls into question.js for Gemini work.

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const question = require("./question.js");
const { check: rateCheck } = require("./rateLimit.js");

// Global process-level handlers to ensure uncaught errors are logged in CloudWatch
process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({ type: "uncaughtException", ts: Date.now(), error: String(err && err.message || err), stack: err && err.stack }));
});
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ type: "unhandledRejection", ts: Date.now(), reason: String(reason) }));
});
// Current request correlation id, set at handler entry and cleared after.
let CURRENT_CORRELATION_ID = null;
// ---------- Config ----------

// SELF_ORIGIN can be overridden via env. Used for the Origin check and CORS
// echo. In dev, the value is "http://localhost:8000"; in prod, the
// Lambda Function URL like "https://abc.lambda-url.us-east-1.on.aws".
const SELF_ORIGIN = process.env.SELF_ORIGIN || "";

const MAX_BODY_BYTES = 1024;        // 1 KB hard cap per request body
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const ALLOWED_CATEGORIES = new Set([
  "Spicy", "Deep End", "Chaos", "Story Time", "Future", "Fast Fire",
]);

// ---------- Static asset cache ----------
// Read files at module load so we don't hit the filesystem on every request.
// Lambda's /var/task is read-only so this is safe.

const PUBLIC_DIR = path.join(__dirname, "public");
let INDEX_HTML = null;
function loadIndexHtml() {
  if (INDEX_HTML === null) {
    INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  }
  return INDEX_HTML;
}

// Serve a file from public/ by relative path. Path traversal guard: must not
// contain "..", must resolve under PUBLIC_DIR.
function serveStatic(relPath, defaultContentType) {
  if (!relPath || relPath.includes("..") || path.isAbsolute(relPath)) return null;
  const abs = path.resolve(PUBLIC_DIR, relPath);
  if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) return null;
  try {
    const data = fs.readFileSync(abs);
    const ext = path.extname(abs).toLowerCase();
    const ct =
      defaultContentType ||
      ({
        ".html": "text/html; charset=utf-8",
        ".js":   "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png":  "image/png",
        ".svg":  "image/svg+xml",
        ".webmanifest": "application/manifest+json",
      }[ext] || "application/octet-stream");
    return { data, contentType: ct };
  } catch (_) {
    return null;
  }
}

// ---------- Token ----------

function mintToken() {
  const ts = Date.now().toString();
  const sig = crypto
    .createHmac("sha256", process.env.HMAC_SECRET || "")
    .update(ts)
    .digest("hex");
  return `${ts}.${sig}`;
}

// Returns { valid: boolean, reason?: string } where reason can be:
// "expired" (token too old), "invalid_format", "invalid_signature", or undefined if valid
function validateToken(token) {
  if (typeof token !== "string") return { valid: false, reason: "invalid_format" };
  const dot = token.indexOf(".");
  if (dot < 0) return { valid: false, reason: "invalid_format" };
  const ts = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(ts) || !/^[a-f0-9]{64}$/.test(sig)) {
    return { valid: false, reason: "invalid_format" };
  }
  const tsNum = parseInt(ts, 10);
  const age = Date.now() - tsNum;
  if (!Number.isFinite(age) || age < 0) return { valid: false, reason: "invalid_format" };
  if (age > TOKEN_TTL_MS) return { valid: false, reason: "expired" };
  const expected = crypto
    .createHmac("sha256", process.env.HMAC_SECRET || "")
    .update(ts)
    .digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
    return { valid: false, reason: "invalid_signature" };
  }
  return { valid: true };
}

// ---------- CORS ----------

function corsHeadersFor(requestOrigin) {
  // Echo the request's Origin only if it matches our own. Never wildcard.
  if (!SELF_ORIGIN || !requestOrigin) return { Vary: "Origin" };
  if (requestOrigin === SELF_ORIGIN) {
    return {
      "Access-Control-Allow-Origin": SELF_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
      "Vary": "Origin",
    };
  }
  return { Vary: "Origin" };
}

function buildResponse(status, body, contentType, requestOrigin, extraHeaders = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const headers = {
    "Content-Type": contentType,
    ...corsHeadersFor(requestOrigin),
    ...extraHeaders,
  };
  if (!headers["X-Correlation-Id"] && CURRENT_CORRELATION_ID) headers["X-Correlation-Id"] = CURRENT_CORRELATION_ID;

  let outBody = body;
  // If this is a JSON response and the body is a string containing a JSON
  // object, inject the correlationId field so clients see it inside the
  // response body as well as the header.
  try {
    const ct = (contentType || "").toLowerCase();
    if (!isBuffer && typeof outBody === "string" && ct.includes("application/json")) {
      const parsed = JSON.parse(outBody);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!parsed.correlationId && CURRENT_CORRELATION_ID) parsed.correlationId = CURRENT_CORRELATION_ID;
        outBody = JSON.stringify(parsed);
      }
    }
  } catch (_) {
    // If parsing fails, leave the body unchanged.
  }

  return {
    statusCode: status,
    headers,
    body: isBuffer ? body.toString("base64") : outBody,
    isBase64Encoded: isBuffer,
  };
}

// ---------- Helpers ----------

function getRequestContext(event) {
  const headers = event.headers || {};
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  const requestContext = event.requestContext || {};
  return {
    requestId: requestContext.requestId || lower["x-amzn-trace-id"] || "local",
    correlationId: lower["x-correlation-id"] || lower["x-request-id"] || null,
    ip: lower["x-forwarded-for"]?.split(",")[0].trim() || requestContext.http?.sourceIp || "0.0.0.0",
    ua: lower["user-agent"] || "",
    referer: lower["referer"] || lower["referrer"] || "",
    origin: lower["origin"] || "",
    method: event.httpMethod || requestContext.http?.method || "GET",
    rawPath: event.rawPath || (event.path || "/"),
  };
}

function logLine(line) {
  if (line && !line.correlationId && CURRENT_CORRELATION_ID) line.correlationId = CURRENT_CORRELATION_ID;
  console.log(JSON.stringify(line));
}

function logError(err, ctx) {
  const out = {
    type: "internal_error",
    requestId: ctx?.requestId || "local",
    ts: Date.now(),
    error: String(err && err.message || err),
    stack: err && err.stack,
  };
  if (ctx?.correlationId) out.correlationId = ctx.correlationId;
  else if (CURRENT_CORRELATION_ID) out.correlationId = CURRENT_CORRELATION_ID;
  console.error(JSON.stringify(out));
}

// ---------- Handlers ----------

async function handleGet(ctx) {
  const url = ctx.rawPath.split("?")[0];

  // The root serves the app shell with an embedded session token.
  if (url === "/" || url === "/index.html") {
    const html = loadIndexHtml();
    const token = mintToken();
    const body = html.replace("__SESSION_TOKEN_PLACEHOLDER__", token);
    logLine({
      type: "page_load",
      requestId: ctx.requestId,
      ts: Date.now(),
      ip: ctx.ip,
      ua: ctx.ua,
      referer: ctx.referer,
      warmup: ctx.rawPath.includes("warmup=1"),
    });
    return buildResponse(200, body, "text/html; charset=utf-8", ctx.origin);
  }

  // Everything else under / serves from public/.
  const rel = url.replace(/^\/+/, "");
  const staticFile = serveStatic(rel);
  if (staticFile) {
    return buildResponse(200, staticFile.data, staticFile.contentType, ctx.origin);
  }
  return buildResponse(404, "Not Found", "text/plain; charset=utf-8", ctx.origin);
}

function parseJsonBody(event) {
  if (!event.body) return { ok: false, status: 403, reason: "no body" };
  const body = typeof event.body === "string" ? Buffer.from(event.body, "utf8") : event.body;
  if (body.length > MAX_BODY_BYTES) return { ok: false, status: 413, reason: "body too large" };
  try {
    return { ok: true, body: JSON.parse(body.toString("utf8")) };
  } catch (_) {
    return { ok: false, status: 403, reason: "bad json" };
  }
}

async function handlePostQuestion(ctx, event) {
  const token = (event.headers?.["X-Session-Token"] || event.headers?.["x-session-token"] || "");
  const bodyLength = event.body ? (typeof event.body === "string" ? Buffer.byteLength(event.body, "utf8") : event.body.length) : 0;
  logLine({
    type: "question_request",
    requestId: ctx.requestId,
    ts: Date.now(),
    ip: ctx.ip,
    path: ctx.rawPath,
    origin: ctx.origin,
    tokenPresent: Boolean(token),
    bodyLength,
  });

  const tokenCheck = validateToken(token);
  if (!tokenCheck.valid) {
    const errorBody = { error: "forbidden", reason: tokenCheck.reason };
    logLine({ type: "question", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "invalid_token", tokenPresent: Boolean(token), reason: tokenCheck.reason, correlationId: ctx.correlationId });
    return buildResponse(403, JSON.stringify(errorBody), "application/json", ctx.origin);
  }

  if (SELF_ORIGIN && ctx.origin && ctx.origin !== SELF_ORIGIN) {
    logLine({ type: "question", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "forbidden", reason: "origin_mismatch", origin: ctx.origin, expected: SELF_ORIGIN });
    return buildResponse(403, "Forbidden", "application/json", ctx.origin);
  }

  const rl = rateCheck(ctx.ip);
  if (!rl.allowed) {
    logLine({ type: "question", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "rate_limited", retryAfterMs: rl.retryAfterMs });
    return buildResponse(429, JSON.stringify({ error: "rate_limited" }), "application/json", ctx.origin, { "Retry-After": String(Math.ceil((rl.retryAfterMs || 60_000) / 1000)) });
  }

  const parsed = parseJsonBody(event);
  if (!parsed.ok) {
    logLine({ type: "question", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: parsed.reason, bodyLength });
    return buildResponse(parsed.status, JSON.stringify({ error: "forbidden" }), "application/json", ctx.origin);
  }

  const { category, questionNumber, totalQuestions, playerNames, keepItLight, relationshipStage } = parsed.body || {};
  if (
    typeof category !== "string" ||
    !ALLOWED_CATEGORIES.has(category) ||
    typeof questionNumber !== "number" ||
    typeof totalQuestions !== "number" ||
    !Array.isArray(playerNames) ||
    playerNames.length !== 2 ||
    !playerNames.every((n) => typeof n === "string" && n.length > 0)
  ) {
    logLine({
      type: "question",
      requestId: ctx.requestId,
      ts: Date.now(),
      ip: ctx.ip,
      outcome: "forbidden",
      reason: "bad body",
      category: typeof category,
      questionNumber: typeof questionNumber,
      totalQuestions: typeof totalQuestions,
      playerNames: Array.isArray(playerNames) ? playerNames.map((n) => typeof n === "string" ? n : typeof n) : typeof playerNames,
    });
    return buildResponse(403, JSON.stringify({ error: "forbidden" }), "application/json", ctx.origin);
  }

  let stage = 0;
  if (typeof relationshipStage === "number") {
    stage = Math.max(0, Math.min(3, Math.floor(relationshipStage)));
  } else if (keepItLight === false) {
    stage = 2;
  }

  let result;
  try {
    result = await question.generateQuestion({
      category,
      questionNumber,
      totalQuestions,
      playerNames,
      relationshipStage: stage,
      correlationId: ctx.correlationId,
    });
  } catch (err) {
    logError(err, ctx);
    return buildResponse(500, JSON.stringify({ error: "internal_server_error" }), "application/json", ctx.origin);
  }

  const outcome = result.source === "fallback" ? "fallback" : "ok";
  logLine({
    type: "question",
    requestId: ctx.requestId,
    ts: Date.now(),
    ip: ctx.ip,
    category,
    questionNumber,
    latencyMs: result.latencyMs,
    geminiMs: result.geminiMs,
    outcome,
  });

  return buildResponse(200, JSON.stringify({ question: result.question, tip: result.tip }), "application/json", ctx.origin);
}

async function handlePostVibe(ctx, event) {
  const token = (event.headers?.["X-Session-Token"] || event.headers?.["x-session-token"] || "");
  const tokenCheck = validateToken(token);
  if (!tokenCheck.valid) {
    const errorBody = { error: "forbidden", reason: tokenCheck.reason };
    logLine({ type: "vibe", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "invalid_token", reason: tokenCheck.reason, correlationId: ctx.correlationId });
    return buildResponse(403, JSON.stringify(errorBody), "application/json", ctx.origin);
  }

  if (SELF_ORIGIN && ctx.origin && ctx.origin !== SELF_ORIGIN) {
    logLine({ type: "vibe", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "forbidden" });
    return buildResponse(403, "Forbidden", "application/json", ctx.origin);
  }

  const rl = rateCheck(ctx.ip);
  if (!rl.allowed) {
    logLine({ type: "vibe", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "rate_limited" });
    return buildResponse(429, JSON.stringify({ error: "rate_limited" }), "application/json", ctx.origin, { "Retry-After": "60" });
  }

  const parsed = parseJsonBody(event);
  if (!parsed.ok) {
    logLine({ type: "vibe", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: parsed.reason });
    return buildResponse(parsed.status, JSON.stringify({ error: "forbidden" }), "application/json", ctx.origin);
  }

  const { answeredCount, categoryCounts, skips, playerNames } = parsed.body || {};
  if (
    typeof answeredCount !== "number" ||
    typeof categoryCounts !== "object" ||
    typeof skips !== "object" ||
    !Array.isArray(playerNames) ||
    playerNames.length !== 2
  ) {
    logLine({ type: "vibe", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, outcome: "forbidden", reason: "bad body" });
    return buildResponse(403, JSON.stringify({ error: "forbidden" }), "application/json", ctx.origin);
  }

  let vibeResult;
  try {
    vibeResult = await question.generateVibe({ answeredCount, categoryCounts, skips, playerNames, correlationId: ctx.correlationId });
  } catch (err) {
    logError(err, ctx);
    return buildResponse(500, JSON.stringify({ error: "internal_server_error" }), "application/json", ctx.origin);
  }
  const outcome = vibeResult.source === "fallback" ? "fallback" : "ok";
  logLine({ type: "vibe", requestId: ctx.requestId, ts: Date.now(), ip: ctx.ip, latencyMs: vibeResult.latencyMs, outcome });

  return buildResponse(200, JSON.stringify({ vibe: vibeResult.vibe }), "application/json", ctx.origin);
}

function handleOptions(ctx) {
  // Preflight. Always return 204 with CORS headers for the matching origin.
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
    "Access-Control-Max-Age": "86400",
    ...corsHeadersFor(ctx.origin),
  };
  if (!headers["X-Correlation-Id"] && CURRENT_CORRELATION_ID) headers["X-Correlation-Id"] = CURRENT_CORRELATION_ID;
  return { statusCode: 204, headers, body: "" };
}

// ---------- Entry ----------

exports.handler = async (event) => {
  const ctx = getRequestContext(event);
  // Ensure a correlation id is set for this request
  if (!ctx.correlationId) ctx.correlationId = crypto.randomUUID();
  CURRENT_CORRELATION_ID = ctx.correlationId;

  try {
    if (ctx.method === "OPTIONS") {
      return handleOptions(ctx);
    }
    if (ctx.method === "GET") {
      return await handleGet(ctx);
    }
    if (ctx.method === "POST") {
      if (ctx.rawPath.endsWith("/question")) return await handlePostQuestion(ctx, event);
      if (ctx.rawPath.endsWith("/vibe"))     return await handlePostVibe(ctx, event);
      return buildResponse(403, "Forbidden", "application/json", ctx.origin);
    }
    return buildResponse(403, "Forbidden", "application/json", ctx.origin);
  } catch (err) {
    // Catch-all so the error is logged to CloudWatch and a 500 is returned.
    logError(err, ctx);
    return buildResponse(500, JSON.stringify({ error: "internal_server_error" }), "application/json", ctx.origin);
  } finally {
    CURRENT_CORRELATION_ID = null;
  }
};
