require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
console.log("API Key present:", !!apiKey);

if (!apiKey) {
  console.log("ERROR: No API key!");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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

model.generateContent(prompt).then(result => {
  const text = result.response.text();
  console.log("Response type:", typeof text);
  console.log("Response length:", text.length);
  console.log("Response preview (first 500 chars):");
  console.log(text.substring(0, 500));
  console.log("\n---END PREVIEW---");
}).catch(err => {
  console.log("Error:", err.message);
});
