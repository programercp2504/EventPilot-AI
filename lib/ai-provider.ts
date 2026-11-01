
type AiProviderOptions = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  json?: boolean;
  timeoutMs?: number;
};

const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:1.5b";

export async function generateAiText({
  systemPrompt,
  userPrompt,
  temperature = 0.7,
  maxOutputTokens = 1000,
  json = false,
  timeoutMs = 45_000,
}: AiProviderOptions): Promise<{
  text: string;
  engine: "gemini" | "ollama";
} | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Production: Gemini API
    if (process.env.VERCEL === "1") {
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        console.error("GEMINI_API_KEY is missing.");
        return null;
      }

      const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: userPrompt }],
              },
            ],
            generationConfig: {
              temperature,
              maxOutputTokens,
              ...(json ? { responseMimeType: "application/json" } : {}),
            },
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "Gemini API error:",
          response.status,
          errorText.slice(0, 1000),
        );
        return null;
      }

      const payload: unknown = await response.json();

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("candidates" in payload) ||
        !Array.isArray(payload.candidates)
      ) {
        return null;
      }

      const candidate = payload.candidates[0];

      if (
        typeof candidate !== "object" ||
        candidate === null ||
        !("content" in candidate) ||
        typeof candidate.content !== "object" ||
        candidate.content === null ||
        !("parts" in candidate.content) ||
        !Array.isArray(candidate.content.parts)
      ) {
        return null;
      }

      const result = candidate.content.parts
        .filter(
          (part: unknown): part is { text: string } =>
            typeof part === "object" &&
            part !== null &&
            "text" in part &&
            typeof part.text === "string",
        )
        .map((part: { text: string }) => part.text)
        .join("");

      if (!result.trim()) return null;

      return {
        text: result,
        engine: "gemini",
      };
    }

    // Local development: Ollama
    const response = await fetch(
      process.env.OLLAMA_URL ||
        "http://127.0.0.1:11434/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
          stream: false,
          ...(json ? { format: "json" } : {}),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          options: {
            temperature,
            num_predict: maxOutputTokens,
          },
        }),
      },
    );

    if (!response.ok) return null;

    const payload: unknown = await response.json();

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("message" in payload) ||
      typeof payload.message !== "object" ||
      payload.message === null ||
      !("content" in payload.message) ||
      typeof payload.message.content !== "string"
    ) {
      return null;
    }

    const result = payload.message.content.trim();

    if (!result) return null;

    return {
      text: result,
      engine: "ollama",
    };
  } catch (error) {
    console.error("AI provider request failed:", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
