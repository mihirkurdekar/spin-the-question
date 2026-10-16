// Gemini call + robust JSON parsing + /vibe logic.
// This module knows nothing about Lambda or HTTP — it's called by index.js.

const fallbacks = require("./fallbacks.js");

let cachedClient = null;
let modelIndex = 0;
let exhaustedModelIndex = null;

function getClient() {
  if (!cachedClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    const { GoogleGenAI } = require("@google/genai");
    cachedClient = new GoogleGenAI({ apiKey });
  }
  return cachedClient;
}

function getModelList() {
  const envList = process.env.GEMINI_MODEL_PRIORITIES || "gemini-2.5-flash";
  return envList.split(",").map((m) => m.trim()).filter(Boolean);
}

function getModelName() {
  const models = getModelList();
  if (!models.length) return "gemini-2.5-flash";
  // Skip exhausted model if there's an alternative
  if (exhaustedModelIndex !== null && exhaustedModelIndex < models.length) {
    const fallbackIndex = (exhaustedModelIndex + 1) % models.length;
    if (fallbackIndex !== exhaustedModelIndex) {
      modelIndex = fallbackIndex;
    }
  }
  if (modelIndex >= models.length) modelIndex = 0;
  return models[modelIndex];
}

function markModelExhausted() {
  const models = getModelList();
  exhaustedModelIndex = modelIndex;
  // Advance to next model for future calls
  modelIndex = (modelIndex + 1) % models.length;
}

function resetModelRotation() {
  exhaustedModelIndex = null;
  modelIndex = 0;
}

// Stage clauses for generic use (Light/Medium/Deep)
const STAGE_CLAUSES = {
  0: "Light — safe, fun, playful questions for anyone",
  1: "Medium — slightly more personal, lifestyle preferences",
  2: "Deep — thoughtful questions about values, fears, life goals"
};

// Relationship-specific clauses added to the Gemini prompt
const RELATIONSHIP_CLAUSES = {
  dating: "Focus on romantic connection, getting to know each other, and future compatibility.",
  friendship: "Focus on building platonic connections, shared interests, and personality compatibility.",
  professional: "Focus on career goals, professional interests, and networking/collaboration.",
  groups: "Focus on group settings — team dynamics, collaboration, and shared experiences."
};

// Build the prompt. Pulled out so it's testable.
function buildQuestionPrompt({ category, stage, relationship = "dating" }) {
  const stageNum = (typeof stage === "number") ? stage : 0;
  const stageClause = STAGE_CLAUSES[stageNum] || STAGE_CLAUSES[0];
  const relationshipClause = RELATIONSHIP_CLAUSES[relationship] || RELATIONSHIP_CLAUSES.dating;

  return `You are generating questions for a conversation game called "Spin the Question".
Relationship context: ${relationship}
${relationshipClause}

This is stage ${stageNum} ${stageClause}.
Category: ${category}

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "question": "the question text (max 20 words, direct, no fluff)",
  "tip": "a one-line conversation nudge for after they answer (max 12 words)"
}`;
}

// Vibe generation removed — return a simple generic message.
function buildVibePrompt() {
  return `You are writing a one-sentence encouraging message for continuing the conversation game "Spin the Question".

Respond with ONLY a valid JSON object, no markdown, no explanation:
{ "vibe": "Keep the conversation going — you're doing great!" }

Max 30 words. Warm, specific, a little playful. Avoid clichés like "soulmates" and "perfect match."`;
}

// Parse the model response as JSON.
function safeJsonParse(text) {
  return JSON.parse(text);
}

// Fallback vibes removed — game no longer tracks players or counts

async function generateQuestion({ category, stage = 0, relationship = "dating", correlationId }) {
  const prompt = buildQuestionPrompt({ category, stage, relationship });
  const t0 = Date.now();
  let geminiMs = 0;

  // Support multiple model attempts on quota/rate limit errors
  let lastError = null;
  const maxAttempts = getModelList().length;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (process.env.FORCE_FALLBACKS === "1") {
        throw new Error("FORCE_FALLBACKS is enabled");
      }

      const ai = getClient(); // Use getClient() not getModel() for new SDK
      const t1 = Date.now();
      const result = await ai.models.generateContent({
        model: getModelName(), // Use rotating model
        contents: prompt,
        config: {
          maxOutputTokens: 512,
          temperature: 0.9,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
          responseSchema: {
            type: "OBJECT",
            properties: {
              question: { type: "STRING" },
              tip: { type: "STRING" },
            },
            required: ["question", "tip"],
            propertyOrdering: ["question", "tip"],
          },
        },
      });
      geminiMs = Date.now() - t1;

      // The new SDK v2 returns { parsed, text } when responseMimeType is set
      const parsed = result.parsed;
      // If parsed is available, use it; otherwise fall back to result.text()
      if (parsed && typeof parsed.question === "string" && typeof parsed.tip === "string") {
        // Reset exhaustion tracking on success
        resetModelRotation();
        return {
          question: parsed.question,
          tip: parsed.tip,
          source: "gemini",
          latencyMs: Date.now() - t0,
          geminiMs,
        };
      }
      // Fallback: try result.text() if it's a function, or result.text if it's a string
      let text = "";
      if (typeof result.text === "function") {
        text = result.text();
      } else if (typeof result.text === "string") {
        text = result.text;
      } else if (typeof result.text === "object" && result.text?.text) {
        text = result.text.text;
      }
      if (text) {
        const fallbackParsed = safeJsonParse(text);
        if (fallbackParsed && typeof fallbackParsed.question === "string" && typeof fallbackParsed.tip === "string") {
          // Reset exhaustion tracking on success
          resetModelRotation();
          return {
            question: fallbackParsed.question,
            tip: fallbackParsed.tip,
            source: "gemini",
            latencyMs: Date.now() - t0,
            geminiMs,
          };
        }
      }
      // If all else fails, throw to trigger fallback
      throw new Error("Gemini returned invalid response");
    } catch (err) {
      lastError = err;
      // Check if this is an error that warrants trying another model
// Includes quota errors, rate limits, model not found, and service unavailable errors
      const errorStr = String(err).toLowerCase();
      const isRetryableError =
        errorStr.includes("quota") ||
        errorStr.includes("429") ||
        errorStr.includes("resource_exhausted") ||
        errorStr.includes("rate limit") ||
        errorStr.includes("not found") ||
        errorStr.includes("404") ||
        errorStr.includes("503") ||
        errorStr.includes("unavailable") ||
        errorStr.includes("service unavailable") ||
        errorStr.includes("high demand") ||
        errorStr.includes("temporarily") ||
        errorStr.includes("try again");

      if (isRetryableError) {
        // Mark current model as exhausted and try next one
        markModelExhausted();
        // Continue to next iteration to try next model
        continue;
      } else {
        // Non-retryable error - break out to use fallback
        break;
      }
    }
  }

  // If we exhausted all models or had a non-quota error, fall back to hardcoded responses
  // Log and fall back. Never throw out — the spec says never show a blank screen.
  const out = {
    type: "question_gemini_error",
    ts: Date.now(),
    category,
    error: String(lastError && lastError.message || lastError || "All models exhausted or failed"),
    stack: lastError && lastError.stack,
  };
  if (typeof correlationId !== "undefined" && correlationId) out.correlationId = correlationId;
  console.error(JSON.stringify(out));
  const fb = fallbacks.get(category);
  return { ...fb, latencyMs: Date.now() - t0, geminiMs };
}

// Vibe generation simplified — return a generic encouraging message.
function generateVibe() {
  return { vibe: "Keep the conversation going — you're doing great!", source: "fallback", latencyMs: 0 };
}

module.exports = {
  generateQuestion,
  generateVibe,
  // exported for tests
  _internal: { buildQuestionPrompt, buildVibePrompt, safeJsonParse },
};
