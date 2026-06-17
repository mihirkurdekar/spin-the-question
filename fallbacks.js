// Hardcoded fallback questions — used when Gemini is down or returns garbage.
// 10 per category. Picked deterministically so the same caller (no time arg) gets
// a stable fallback, but in practice the time-based index varies per call.

const FALLBACKS = {
  "Spicy": [
    { question: "What's a popular opinion you secretly disagree with?", tip: "Own the take, don't hedge." },
    { question: "What's a small thing that instantly ruins your mood?", tip: "Specificity is funnier than generality." },
    { question: "Pineapple on pizza: defend your position in one sentence.", tip: "No nuance. Pick a side." },
    { question: "What's a harmless thing you judge people for?", tip: "Keep it playful, not mean." },
    { question: "What's overrated but everyone pretends is amazing?", tip: "Say the quiet part gently." },
    { question: "What's a tiny green flag people underrate?", tip: "Specific beats noble." },
    { question: "What trend do you hope disappears forever?", tip: "You may be dramatic." },
    { question: "What's your most defensible unpopular food opinion?", tip: "Make the case in one bite." },
    { question: "What's a rule you think adults should break more often?", tip: "Bonus points for low stakes." },
    { question: "What's something people brag about that never impresses you?", tip: "Aim for funny, not cruel." },
  ],
  "Deep End": [
    { question: "What's something you're still figuring out about yourself?", tip: "Give the real answer, not the rehearsed one." },
    { question: "What do you want more of in your life right now?", tip: "Name one specific thing." },
    { question: "When did you last change your mind about something big?", tip: "Tell the story, not just the conclusion." },
    { question: "What makes you feel most like yourself?", tip: "Think scene, not slogan." },
    { question: "What's a compliment you secretly hope is true?", tip: "Let it be a little vulnerable." },
    { question: "What do you protect your peace from these days?", tip: "Boundaries can be tiny." },
    { question: "What's something you used to chase but don't anymore?", tip: "What changed?" },
    { question: "What kind of person brings out your best side?", tip: "Describe the pattern." },
    { question: "What's a belief you hope never gets cynical?", tip: "Keep the answer alive." },
    { question: "When do you feel easiest to love?", tip: "Small honest answers count." },
  ],
  "Chaos": [
    { question: "Would you rather have wings or a tail? Justify it.", tip: "There is no wrong answer. There are wrong justifications." },
    { question: "You're king for a day. What's the first weird law you pass?", tip: "Go stranger than you think." },
    { question: "Invent a new ice cream flavour. What's in it, what's it called?", tip: "Make me want to try it." },
    { question: "You can mildly haunt one place. Where and how?", tip: "Keep it oddly specific." },
    { question: "What object in this room would win a talent show?", tip: "Explain the act." },
    { question: "You must rename Tuesdays. What's the new name?", tip: "Commit fully." },
    { question: "Which animal would be rudest if it could talk?", tip: "Defend the vibe." },
    { question: "You get a theme song for errands. What genre?", tip: "Perform one second if brave." },
    { question: "What's your survival strategy in a very polite apocalypse?", tip: "Manners matter, apparently." },
    { question: "Pick a useless superpower that would still make you smug.", tip: "The smaller, the better." },
  ],
  "Story Time": [
    { question: "Tell me about the last time you laughed until you cried.", tip: "Set the scene first." },
    { question: "What's a small moment from this year you'll remember for a long time?", tip: "The smaller it is, the better." },
    { question: "What's the best meal you've ever had, and who were you with?", tip: "Both details matter." },
    { question: "Tell me about a time you got unexpectedly lucky.", tip: "Start with where you were." },
    { question: "What's a childhood memory that still feels vivid?", tip: "Name one sensory detail." },
    { question: "Tell me about a time you surprised yourself.", tip: "What did you do next?" },
    { question: "What's the most memorable compliment you've received?", tip: "Who said it?" },
    { question: "Tell me about a trip that went sideways.", tip: "Bad logistics make good stories." },
    { question: "What's a moment you wish had lasted longer?", tip: "Stay in the scene." },
    { question: "Tell me about a time you felt instantly at home.", tip: "Describe the first clue." },
  ],
  "Future": [
    { question: "What does a perfect ordinary Tuesday look like in 5 years?", tip: "Skip the big stuff. Name the small textures." },
    { question: "What's a goal you haven't told many people about?", tip: "The shyer it feels, the more interesting." },
    { question: "What's a dealbreaker you've only realised as an adult?", tip: "Don't soften it." },
    { question: "What's one thing future-you will thank you for starting now?", tip: "Make it concrete." },
    { question: "What kind of home do you want your life to feel like?", tip: "Mood counts." },
    { question: "What's a skill you want to be quietly great at?", tip: "Not everything needs a stage." },
    { question: "What would you like weekends to look like in ten years?", tip: "Ordinary details reveal a lot." },
    { question: "What's a future tradition you want to create?", tip: "Name who it includes." },
    { question: "What are you unwilling to sacrifice for success?", tip: "Draw the line clearly." },
    { question: "What adventure do you hope is still ahead of you?", tip: "Let it be impractical." },
  ],
  "Fast Fire": [
    { question: "Quick: three things you'd grab if your apartment was on fire. Go.", tip: "30 seconds. No thinking out loud." },
    { question: "Name four jobs you'd be terrible at. No pausing.", tip: "Wrong answers only." },
    { question: "Five cities, one minute. Don't explain.", tip: "Fastest wins." },
    { question: "Three snacks, two songs, one movie. Go.", tip: "No honorable mentions." },
    { question: "Name five things that improve a rainy day.", tip: "Keep the pace up." },
    { question: "Pick: sunrise, midnight, ocean, mountains, city.", tip: "First instinct only." },
    { question: "List four fictional characters you'd invite to dinner.", tip: "No explaining until after." },
    { question: "Three words your friends would use for you.", tip: "No modesty delay." },
    { question: "Name five tiny luxuries you love.", tip: "Specific and fast." },
    { question: "Choose one forever: coffee, music, travel, books.", tip: "You must betray three." },
  ],
};

function get(category) {
  const list = FALLBACKS[category] || FALLBACKS["Deep End"];
  // Deterministic-but-varying picker. The per-call time changes, but pick by hash
  // of category+time so two calls in the same second don't collide.
  const seed = Math.abs(Date.now() ^ (category ? category.length : 0));
  const idx = seed % list.length;
  return { ...list[idx], source: "fallback" };
}

module.exports = { get };
