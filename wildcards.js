// Server-side wildcards placeholder. The actual wildcard prompts live in
// public/wildcards.js and are picked client-side (no Gemini call). This file
// is kept as a convention so the Lambda bundle structure stays consistent
// with SPEC.md and so we can add server-side curated prompts later without
// changing the import path.
module.exports = { WILDCARDS: [] };
