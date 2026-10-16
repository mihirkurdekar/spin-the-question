const assert = require("assert");
const crypto = require("crypto");

process.env.HMAC_SECRET = process.env.HMAC_SECRET || "test-secret";
process.env.SELF_ORIGIN = "https://example.lambda-url.us-east-1.on.aws";

let lastGenerateQuestionArgs = null;
const question = require("../question.js");
question.generateQuestion = async (args) => {
  lastGenerateQuestionArgs = args;
  return {
    question: `Question for ${args.category}?`,
    tip: "Keep it moving.",
    source: "fallback",
    latencyMs: 3,
    geminiMs: 0,
  };
};
question.generateVibe = async () => ({
  vibe: "You two seem curious and lightly chaotic.",
  source: "fallback",
  latencyMs: 2,
});

const { handler } = require("../index.js");

function token(ts = Date.now()) {
  const stamp = String(ts);
  const sig = crypto.createHmac("sha256", process.env.HMAC_SECRET).update(stamp).digest("hex");
  return `${stamp}.${sig}`;
}

function event(method, rawPath, body, headers = {}) {
  return {
    version: "2.0",
    rawPath,
    headers: {
      origin: process.env.SELF_ORIGIN,
      "user-agent": "node-test",
      ...headers,
    },
    requestContext: {
      requestId: "test-request",
      http: { method, sourceIp: "127.0.0.1" },
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    throw err;
  }
}

(async () => {
  await run("GET / serves HTML with a session token", async () => {
    const res = await handler(event("GET", "/"));
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /window\.__SESSION_TOKEN__ = "\d+\.[a-f0-9]{64}"/);
  });

  await run("OPTIONS returns CORS preflight", async () => {
    const res = await handler(event("OPTIONS", "/question"));
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["Access-Control-Allow-Origin"], process.env.SELF_ORIGIN);
    assert.equal(res.headers["Access-Control-Allow-Headers"], "Content-Type, X-Session-Token");
  });

  await run("POST /question rejects missing token", async () => {
    const res = await handler(event("POST", "/question", {}));
    assert.equal(res.statusCode, 403);
  });

  await run("POST /question accepts a valid request with relationship=dating (stage 0)", async () => {
    lastGenerateQuestionArgs = null;
    const res = await handler(event("POST", "/question", {
      category: "Chaos",
      stage: 0,
      relationship: "dating",
    }, { "x-session-token": token() }));
    assert.equal(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    // correlationId is injected into JSON responses; ignore it for equality check
    delete parsed.correlationId;
    assert.deepEqual(parsed, {
      question: "Question for Chaos?",
      tip: "Keep it moving.",
    });
    assert.ok(lastGenerateQuestionArgs);
    assert.equal(lastGenerateQuestionArgs.category, "Chaos");
    assert.equal(lastGenerateQuestionArgs.stage, 0);
    assert.equal(lastGenerateQuestionArgs.relationship, "dating");
  });

  await run("POST /question accepts a valid request with relationship=friendship (stage 2)", async () => {
    lastGenerateQuestionArgs = null;
    const res = await handler(event("POST", "/question", {
      category: "Deep End",
      stage: 2,
      relationship: "friendship",
    }, { "x-session-token": token() }));
    assert.equal(res.statusCode, 200);
    assert.ok(lastGenerateQuestionArgs);
    assert.equal(lastGenerateQuestionArgs.category, "Deep End");
    assert.equal(lastGenerateQuestionArgs.stage, 2);
    assert.equal(lastGenerateQuestionArgs.relationship, "friendship");
  });

  await run("POST /question defaults relationship to dating when omitted", async () => {
    lastGenerateQuestionArgs = null;
    const res = await handler(event("POST", "/question", {
      category: "Story Time",
      stage: 1,
    }, { "x-session-token": token() }));
    assert.equal(res.statusCode, 200);
    assert.ok(lastGenerateQuestionArgs);
    assert.equal(lastGenerateQuestionArgs.relationship, "dating");
  });

  await run("POST /question accepts a valid request with relationship=groups (stage 1)", async () => {
    lastGenerateQuestionArgs = null;
    const res = await handler(event("POST", "/question", {
      category: "Future",
      stage: 1,
      relationship: "groups",
    }, { "x-session-token": token() }));
    assert.equal(res.statusCode, 200);
    assert.ok(lastGenerateQuestionArgs);
    assert.equal(lastGenerateQuestionArgs.category, "Future");
    assert.equal(lastGenerateQuestionArgs.stage, 1);
    assert.equal(lastGenerateQuestionArgs.relationship, "groups");
  });

  await run("POST /vibe accepts a valid request", async () => {
    const res = await handler(event("POST", "/vibe", {
      answeredCount: 3,
      categoryCounts: { Chaos: 2, Spicy: 1 },
      skips: { A: 0, B: 1 },
      playerNames: ["A", "B"],
    }, { "x-session-token": token() }));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).vibe, "You two seem curious and lightly chaotic.");
  });
})();
