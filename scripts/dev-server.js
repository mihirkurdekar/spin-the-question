require("dotenv").config();

const http = require("http");

process.env.HMAC_SECRET = process.env.HMAC_SECRET || "local-dev-secret";
process.env.SELF_ORIGIN = process.env.SELF_ORIGIN || "http://127.0.0.1:8000";
process.env.FORCE_FALLBACKS = process.env.FORCE_FALLBACKS || "1";

const { handler } = require("../index.js");

const PORT = Number(process.env.PORT || 8000);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function eventFrom(req, body) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(",") : value;
  }
  if (!headers.origin) headers.origin = process.env.SELF_ORIGIN;
  return {
    version: "2.0",
    rawPath: url.pathname,
    rawQueryString: url.searchParams.toString(),
    headers,
    requestContext: {
      requestId: `local-${Date.now()}`,
      http: {
        method: req.method,
        sourceIp: req.socket.remoteAddress || "127.0.0.1",
      },
    },
    body,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const result = await handler(eventFrom(req, body));
    res.writeHead(result.statusCode || 200, result.headers || {});
    res.end(result.isBase64Encoded ? Buffer.from(result.body || "", "base64") : result.body || "");
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Local dev server error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Spin the Question dev server: http://127.0.0.1:${PORT}`);
  console.log(`FORCE_FALLBACKS=${process.env.FORCE_FALLBACKS}`);
});
