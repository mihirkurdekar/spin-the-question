// Gemini call + robust JSON parsing + /vibe logic.
// This module knows nothing about Lambda or HTTP — it's called by index.js.

const fallbacks = require("./fallbacks.js");

let cachedClient = null;
let modelIndex = 0;

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

function getNextModelName() {
  const models = getModelList();
  if (!models.length) return "gemini-2.5-flash";
  
  // Proactive Round-Robin: pick the current index, then increment for next time
  const name = models[modelIndex % models.length];
  modelIndex++;
  return name;
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

// Personality prompts to shift the AI's tone
const PERSONALITY_PROMPTS = {
  neutral: "Maintain a warm, helpful, and balanced tone.",
  playful: "Be witty, slightly sarcastic, and a bit of a provocateur. Use a bit of banter in the tips.",
  soulful: "Be poetic, introspective, and deeply empathetic. Encourage lingering on the emotions of the answer.",
  chaotic: "Be unpredictable, absurd, and a bit weird. Push the boundaries of a 'normal' conversation."
};

// Build the prompt. Pulled out so it's testable.
function buildQuestionPrompt({ category, stage, relationship = "dating", personality = "neutral", askedQuestions = [] }) {
  const stageNum = (typeof stage === "number") ? stage : 0;
  const stageClause = STAGE_CLAUSES[stageNum] || STAGE_CLAUSES[0];
  const relationshipClause = RELATIONSHIP_CLAUSES[relationship] || RELATIONSHIP_CLAUSES.dating;
  const personalityClause = PERSONALITY_PROMPTS[personality] || PERSONALITY_PROMPTS.neutral;

  const historySection = askedQuestions.length > 0 
    ? `\n\nFORBIDDEN QUESTIONS (Do not repeat or slightly rephrase these):\n- ${askedQuestions.join("\n- ")}` 
    : "";

  return `You are generating questions for a conversation game called "Spin the Question".
Relationship context: ${relationship}
${relationshipClause}

This is stage ${stageNum} ${stageClause}.
Category: ${category}
${historySection}

Your Personality: ${personalityClause}

Style Guidelines:
- Vary the format: mix direct questions, "would you rather" scenarios, and "tell me about a time when" prompts.
- Be natural: occasionally weave the relationship context into the question phrasing.
- Keep it concise: max 20 words per question.

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "question": "the question text (max 20 words, direct, no fluff)",
  "tip": "a one-line conversation nudge for after they answer (max 12 words)"
}`;
}

function buildPortraitPrompt({ relationship, personality, askedQuestions }) {
  const personalityDesc = PERSONALITY_PROMPTS[personality] || PERSONALITY_PROMPTS.neutral;
  
  return `You are an expert social analyst and relationship coach. 
Two people just finished a conversation game. 
Relationship: ${relationship}
AI Personality used during the game: ${personalityDesc}

Here are the questions they answered:
${askedQuestions.map((q, i) => `${i+1}. ${q}`).join("\n")}

Based on the nature of these questions, write a "Conversation Portrait". 
This is a one-sentence, evocative summary of their dynamic. 
It should be warm, slightly poetic, and a bit playful. 
Avoid clichés like "soulmates" or "perfect match". 
Focus on the energy the questions suggest (e.g., "a mix of quiet understanding and sudden bursts of chaos").

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "vibe": "the portrait text (max 30 words)"
}`;
}

// Parse the model response as JSON.
function safeJsonParse(text) {
  return JSON.parse(text);
}

async function generateQuestion({ category, stage = 0, relationship = "dating", personality = "neutral", askedQuestions = [], correlationId }) {
  const prompt = buildQuestionPrompt({ category, stage, relationship, personality, askedQuestions });
  const t0 = Date.now();
  let geminiMs = 0;

  let lastError = null;
  const models = getModelList();
  const maxAttempts = models.length || 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let currentModel;
    if (attempt === 0) {
      currentModel = getNextModelName();
    } else {
      currentModel = models[(modelIndex + attempt - 1) % models.length];
    }

    try {
      if (process.env.FORCE_FALLBACKS === "1") {
        throw new Error("FORCE_FALLBACKS is enabled");
      }

      const ai = getClient();
      const t1 = Date.now();
      const result = await ai.models.generateContent({
        model: currentModel,
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

      const parsed = result.parsed;
      if (parsed && typeof parsed.question === "string" && typeof parsed.tip === "string") {
        return {
          question: parsed.question,
          tip: parsed.tip,
          source: "gemini",
          latencyMs: Date.now() - t0,
          geminiMs,
        };
      }
      
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
          return {
            question: fallbackParsed.question,
            tip: fallbackParsed.tip,
            source: "gemini",
            latencyMs: Date.now() - t0,
            geminiMs,
          };
        }
      }
      throw new Error("Gemini returned invalid response");
    } catch (err) {
      lastError = err;
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

      if (!isRetryableError) break;
    }
  }

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

async function generatePortrait({ relationship, personality, askedQuestions = [], correlationId }) {
  const prompt = buildPortraitPrompt({ relationship, personality, askedQuestions });
  const t0 = Date.now();
  
  try {
    const ai = getClient();
    const result = await ai.models.generateContent({
      model: getNextModelName(),
      contents: prompt,
      config: {
        maxOutputTokens: 200,
        temperature: 0.8,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: "OBJECT",
          properties: {
            vibe: { type: "STRING" },
          },
          required: ["vibe"],
        },
      },
    });

    const parsed = result.parsed;
    if (parsed && typeof parsed.vibe === "string") {
      return {
        vibe: parsed.vibe,
        source: "gemini",
        latencyMs: Date.now() - t0,
      };
    }
    throw new Error("Invalid portrait response");
  } catch (err) {
    console.error(JSON.stringify({
      type: "portrait_error",
      ts: Date.now(),
      error: String(err),
      correlationId,
    }));
    return {
      vibe: "You two shared some great questions. Keep the energy going!",
      source: "fallback",
      latencyMs: Date.now() - t0,
    };
  }
}

function generateVibe() {
  return { vibe: "Keep the conversation going — you're doing great!", source: "fallback", latencyMs: 0 };
}

module.exports = {
  generateQuestion,
  generateVibe,
  generatePortrait,
  _internal: { buildQuestionPrompt, buildPortraitPrompt, safeJsonParse },
};
