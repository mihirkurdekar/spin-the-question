// Gemini call + robust JSON parsing + /vibe logic.
// This module knows nothing about Lambda or HTTP — it's called by index.js.

const fallbacks = require("./fallbacks.js");

let cachedClient = null;
function getModel() {
  if (!cachedClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    cachedClient = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 200,
        temperature: 0.9,
      },
    });
  }
  return cachedClient;
}

const STAGE_CLAUSES = {
  0: "The players are on a first date. Keep questions safe, fun, lighthearted, and playful. Avoid sensitive, heavy, or overly intimate topics like past relationships, family conflicts, mental health, or deep finances.",
  1: "The players are actively dating. They want to get to know each other beyond surface level. Prompts can be slightly more personal, covering funny memories, lifestyle preferences, and general future dreams, but still keeping it relatively comfortable.",
  2: "The players are in a committed relationship. They know each other well and are ready for deeper, more meaningful conversations about values, fears, relationship dynamics, and life goals. Tone can be direct.",
  3: "The players are long-term/married partners. They have a deep history together. Questions can range from highly intimate, deep vulnerabilities, shared histories, spicy/playful topics, to long-term alignment and mature reflections."
};

// Build the prompt. Pulled out so it's testable.
function buildQuestionPrompt({ category, questionNumber, totalQuestions, playerNames, relationshipStage }) {
  const stage = (typeof relationshipStage === "number") ? relationshipStage : 0;
  const stageClause = STAGE_CLAUSES[stage] || STAGE_CLAUSES[0];

  return `You are generating questions for a conversation game called "Spin the Question".
The two players are ${playerNames[0]} and ${playerNames[1]}.
This is question ${questionNumber} of ${totalQuestions} — calibrate depth accordingly (earlier = lighter, later = deeper).
Category: ${category}
Relationship context: ${stageClause}

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "question": "the question text (max 20 words, direct, no fluff)",
  "tip": "a one-line conversation nudge for after they answer (max 12 words)"
}

Category guidance:
- Spicy: mild controversy, hot takes, opinions — fun but not offensive
- Deep End: values, fears, what matters to them — thoughtful not heavy
- Chaos: weird hypotheticals, absurd would-you-rathers — keep it playful
- Story Time: prompt a real specific memory — "tell me about a time when..."
- Future: dreams, goals, dealbreakers — skip the LinkedIn version
- Fast Fire: rapid-fire format, multiple quick items, 30 seconds to answer`;
}

function buildVibePrompt({ answeredCount, categoryCounts, skips, playerNames }) {
  const top = Object.entries(categoryCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, n]) => `${c} (${n})`)
    .join(", ") || "no categories recorded";

  return `You are writing a one-sentence "vibe summary" for two people who just played a conversation game called "Spin the Question". The players are ${playerNames[0]} and ${playerNames[1]}. They answered ${answeredCount} questions. Their top categories were ${top}.

Respond with ONLY a valid JSON object, no markdown, no explanation:
{ "vibe": "You two seem like the kind of people who would..." }

Max 30 words. Warm, specific, a little playful. Avoid clichés like "soulmates" and "perfect match."`;
}

// Two-pass robust JSON parser. Strips ```json``` fences and tries again.
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const stripped = String(text)
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    return JSON.parse(stripped);
  }
}

function pickFallbackVibe({ playerNames, answeredCount, categoryCounts }) {
  const sorted = Object.entries(categoryCounts || {}).sort((a, b) => b[1] - a[1]);
  const top = sorted[0]?.[0] || "Deep End";
  const second = sorted[1]?.[0] || "Chaos";
  return `${playerNames[0]} & ${playerNames[1]} answered ${answeredCount} questions — ${top} lovers with a soft spot for ${second}.`;
}

async function generateQuestion({ category, questionNumber, totalQuestions, playerNames, relationshipStage = 0, correlationId }) {
  const prompt = buildQuestionPrompt({ category, questionNumber, totalQuestions, playerNames, relationshipStage });
  const t0 = Date.now();
  let geminiMs = 0;
  try {
    if (process.env.FORCE_FALLBACKS === "1") {
      throw new Error("FORCE_FALLBACKS is enabled");
    }
    const model = getModel();
    const t1 = Date.now();
    const result = await model.generateContent(prompt);
    geminiMs = Date.now() - t1;
    const text = result.response.text();
    const parsed = safeJsonParse(text);
    if (!parsed || typeof parsed.question !== "string" || typeof parsed.tip !== "string") {
      throw new Error("Gemini returned JSON but missing question/tip fields");
    }
    return {
      question: parsed.question,
      tip: parsed.tip,
      source: "gemini",
      latencyMs: Date.now() - t0,
      geminiMs,
    };
  } catch (err) {
    // Log and fall back. Never throw out — the spec says never show a blank screen.
    const out = {
      type: "question_gemini_error",
      ts: Date.now(),
      category,
      error: String(err && err.message || err),
      stack: err && err.stack,
    };
    if (typeof correlationId !== "undefined" && correlationId) out.correlationId = correlationId;
    console.error(JSON.stringify(out));
    const fb = fallbacks.get(category);
    return { ...fb, latencyMs: Date.now() - t0, geminiMs };
  }
}

async function generateVibe({ answeredCount, categoryCounts, skips, playerNames, correlationId }) {
  const prompt = buildVibePrompt({ answeredCount, categoryCounts, skips, playerNames });
  const t0 = Date.now();
  try {
    if (process.env.FORCE_FALLBACKS === "1") {
      throw new Error("FORCE_FALLBACKS is enabled");
    }
    const model = getModel();
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = safeJsonParse(text);
    if (!parsed || typeof parsed.vibe !== "string") throw new Error("Gemini returned JSON but missing vibe field");
    return { vibe: parsed.vibe, source: "gemini", latencyMs: Date.now() - t0 };
  } catch (err) {
    const out = {
      type: "vibe_gemini_error",
      ts: Date.now(),
      error: String(err && err.message || err),
      stack: err && err.stack,
    };
    if (typeof correlationId !== "undefined" && correlationId) out.correlationId = correlationId;
    console.error(JSON.stringify(out));
    return { vibe: pickFallbackVibe({ playerNames, answeredCount, categoryCounts }), source: "fallback", latencyMs: Date.now() - t0 };
  }
}

module.exports = {
  generateQuestion,
  generateVibe,
  // exported for tests
  _internal: { buildQuestionPrompt, buildVibePrompt, safeJsonParse, pickFallbackVibe },
};
