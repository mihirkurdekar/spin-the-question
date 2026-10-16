require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

// WITHOUT responseMimeType: "application/json" (as fallback)
const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    maxOutputTokens: 200,
    temperature: 0.9,
  },
});

const prompt = `You are generating questions for a conversation game called "Spin the Question".
The two players are Alice and Bob.
This is question 1 of 20 — calibrate depth accordingly (earlier = lighter, later = deeper).
Category: Spicy
Relationship context: The players are on a first date. Keep questions safe, fun, lighthearted, and playful.

Respond with ONLY a valid JSON object, no markdown, no explanation:
{
  "question": "the question text (max 20 words, direct, no fluff)",
  "tip": "a one-line conversation nudge for after they answer (max 12 words)"
}`;

console.log("Calling Gemini API WITHOUT responseMimeType");
model.generateContent(prompt).then(result => {
  const text = result.response.text();
  console.log("Response received! Length:", text.length);
  console.log("Response:", text);
  
  // Try parsing
  try {
    const parsed = JSON.parse(text);
    console.log("Parsed successfully:", parsed);
  } catch(e) {
    console.log("Failed to parse as JSON:", e.message);
  }
}).catch(err => {
  console.log("Error calling Gemini:", err.message);
});
