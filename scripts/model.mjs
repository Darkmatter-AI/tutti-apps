// Calling a model through the AI Gateway. The key stays in this file's request
// and every answer is treated as data by whoever asked: it is parsed, checked
// and cut down before anything acts on it.

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";
const TIMEOUT_MS = 120_000;

export const SEARCH_MODEL = "perplexity/sonar";
export const THINKING_MODEL = "anthropic/claude-sonnet-5.5";

export async function ask({ model, system, user, maxTokens = 800 }) {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) {
    throw new Error("AI_GATEWAY_API_KEY isn't set");
  }
  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`The AI Gateway answered ${response.status}`);
  }
  const answer = await response.json();
  const text = answer?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("The AI Gateway gave no text");
  }
  return text;
}

/** The first JSON object in a model's answer, or undefined. */
export function firstObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** What an independent search says about an app's server, as plain text for another model to weigh. */
export function searchForServer(name) {
  return ask({
    model: SEARCH_MODEL,
    system:
      "You look up facts in companies' own documentation. Answer in under 120 words and give full addresses. If you find nothing official, say so.",
    user: `What is the address of the official remote MCP server run by the company behind the app named "${name}", and which domains does that company own? Only count that company's own documentation.`,
    maxTokens: 400,
  });
}
