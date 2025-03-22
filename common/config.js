import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  dataDirBase: process.env.DATA_DIR_BASE || './data',
  llm: {
    model: process.env.LLM_MODEL || "llama3.2",
    temperature: Number(process.env.LLM_TEMPERATURE) || 0,
    maxRetries: Number(process.env.LLM_MAX_RETRIES) || 2,
    baseUrl: process.env.LLM_BASE_URL || "http://localhost:11434"
  },
  batchSize: Number(process.env.BATCH_SIZE) || 1,
  prompt: {
    summary: `Return a JSON object with a single key "summary" amd its value being a concise, clear and relevent summary of context in 10 words or less.

Title: """{title}"""

Content: """{content}"""

Only output a valid JSON object without any additional text.`,
    tone: `Analyze the tone of the following page and return a JSON object with a single key "tone" and its value being one of the following options: friendly, professional, authoritative, playful, casual, informative, empathetic, enthusiastic, neutral, optimistic, inquisitive, formal, motivational, witty, sincere, compassionate, persuasive, balanced.

Title: """{title}"""

Content: """{content}"""

Only output a valid JSON object without any additional text.`,
  interests: `Return a JSON object with a single key "interests" and its values being a list o up to 10 single-word terms in lowercase (no plurals or compound words) as a JSON array.
Exclude generic terms like "article", "page", "information", "content", "website", "post". 

  Title: """{title}"""
  
  Content: """{content}"""

  Summary: """{summary}"""

  Only output a valid JSON object without any additional text.`,
  narrative: `Analyze the narrative of the following page and return a JSON object with a single key "narrative" and its value being a list with any of the following options: "Self-Reflection", "Facts-and-Figures", "How-To", "Case Study", "Opinion Piece",  "Comparative Analysis", "Expert Interview", "Step-by-Step Guide", "Trend Analysis",  "Myth vs. Reality", "Problem-Solution", "Listicle", "Deep Dive/Explainer", "Behind-the-Scenes",  "Frequently Asked Questions (FAQ)", "Beginner’s Guide", "Historical Perspective",  "Success Story", "Industry Report", "Checklist or Cheat Sheet".

Title: """{title}"""

Content: """{content}"""

Only output a valid JSON object without any additional text.`
}
};

