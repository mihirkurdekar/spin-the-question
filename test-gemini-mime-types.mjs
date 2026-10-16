import { GoogleGenerativeAI } from "/Users/mihirkurdekar/repos/spin-the-question/node_modules/@google/generative-ai/build/esm/index.js";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
console.log("API Key:", apiKey ? "SET" : "NOT SET");

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
    console.log(`Mime: ${type} | Length: ${text.length}`);
    if (text.length < 200) {
      console.log(`  Response: ${text}`);
    } else {
      console.log(`  Preview: ${text.substring(0, 100)}...`);
    }
  } catch(err) {
    console.log(`Mime: ${type} | Error: ${err.message}`);
  }
}

// Test them sequentially
for (const mime of mimeTypes) {
  await testMime(mime);
  // Wait a bit between calls
  await new Promise(r => setTimeout(r, 1000));
}
