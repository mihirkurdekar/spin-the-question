require("dotenv").config();
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET (length " + process.env.GEMINI_API_KEY.length + ")" : "NOT SET");
console.log("FORCE_FALLBACKS before override:", process.env.FORCE_FALLBACKS);
process.env.FORCE_FALLBACKS = process.env.FORCE_FALLBACKS || "1";
console.log("FORCE_FALLBACKS after override:", process.env.FORCE_FALLBACKS);
