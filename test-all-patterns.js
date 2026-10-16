require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

// Test 1: Normal generateContent without any special config
console.log("=== Test 1: Normal generateContent (no generationConfig) ===");
const model1 = new GoogleGenerativeAI(apiKey).getGenerativeModel({
  model: "gemini-2.5-flash",
});

model1.generateContent("Give me a fun question for a date game, respond with JSON: {\"question\": \"your question\", \"tip\": \"your tip\"}").then(result => {
  const text = result.response.text();
  console.log("Response:", text);
  try {
    const parsed = JSON.parse(text);
    console.log("Parsed OK:", parsed);
  } catch(e) {
    console.log("Parse error:", e.message);
  }
}).catch(err => {
  console.log("Error:", err.message);
});

// Wait a bit then test 2
setTimeout(() => {
  console.log("\n=== Test 2: With responseMimeType text/plain ===");
  const model2 = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "text/plain",
    },
  });
  
  model2.generateContent("Give me a fun question for a date game, respond with JSON: {\"question\": \"your question\", \"tip\": \"your tip\"}").then(result => {
    const text = result.response.text();
    console.log("Response:", text);
    try {
      const parsed = JSON.parse(text);
      console.log("Parsed OK:", parsed);
    } catch(e) {
      console.log("Parse error:", e.message);
    }
  }).catch(err => {
    console.log("Error:", err.message);
  });
}, 2000);
