require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

// Test all mime types
const mimeTypes = ["application/json", "text/plain", "text/html", "text/markdown", "text/csv"];

async function testMime(type) {
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: type,
    },
  });
  
  try {
    const result = await model.generateContent("Give me a fun date question with a tip in JSON format: {\"question\": \"?\", \"tip\": \"?\"}");
    const text = result.response.text();
    console.log(`Mime: ${type} | Length: ${text.length} | Response: ${text.substring(0, 100)}...`);
  } catch(err) {
    console.log(`Mime: ${type} | Error: ${err.message}`);
  }
}

// Test them sequentially
for (const mime of mimeTypes) {
  testMime(mime);
  await new Promise(r => setTimeout(r, 500));
}
