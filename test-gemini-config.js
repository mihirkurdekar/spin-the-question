require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

// WITH responseMimeType: "application/json" (as in question.js)
console.log("=== WITH responseMimeType: application/json ===");
const model1 = new GoogleGenerativeAI(apiKey).getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    responseMimeType: "application/json",
    maxOutputTokens: 200,
    temperature: 0.9,
  },
});

model1.generateContent("Hello").then(result => {
  console.log("Response text:", result.response.text());
}).catch(err => {
  console.log("Error:", err.message);
});

// WITHOUT responseMimeType (default)
console.log("\n=== WITHOUT responseMimeType (default) ===");
const model2 = new GoogleGenerativeAI(apiKey).getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    maxOutputTokens: 200,
    temperature: 0.9,
  },
});

model2.generateContent("Hello").then(result => {
  console.log("Response text:", result.response.text());
}).catch(err => {
  console.log("Error:", err.message);
});
