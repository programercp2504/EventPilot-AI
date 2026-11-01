
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:1.5b";
const REQUEST_TIMEOUT_MS = 5000;

function getOllamaConfig() {
  const rawUrl = (
    process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL
  ).trim();

  const model = (
    process.env.OLLAMA_MODEL || DEFAULT_MODEL
  ).trim();

  let ollamaUrl: URL;

  try {
    ollamaUrl = new URL(rawUrl);
  } catch {
    throw new Error("Invalid Ollama URL configuration.");
  }

  if (
    !["http:", "https:"].includes(ollamaUrl.protocol) ||
    ollamaUrl.username ||
    ollamaUrl.password ||
    ollamaUrl.search ||
    ollamaUrl.hash
  ) {
    throw new Error("Invalid Ollama URL configuration.");
  }

  if (
    !model ||
    model.length > 120 ||
    !/^[a-zA-Z0-9._:/-]+$/.test(model)
  ) {
    throw new Error("Invalid Ollama model configuration.");
  }

  return {
    ollamaBaseUrl: ollamaUrl.toString().replace(/\/+$/, ""),
    model,
  };
}

export async function GET() {
  // Vercel production uses hosted Gemini, not the user's local Ollama.
  if (process.env.VERCEL === "1") {
    const configured = Boolean(
      process.env.GEMINI_API_KEY?.trim(),
    );

    return NextResponse.json({
      success: configured,
      status: configured ? "online" : "offline",
      provider: "gemini",
      model: process.env.GEMINI_MODEL || "configured Gemini model",
      modelAvailable: configured,
      message: configured
        ? "Gemini AI is configured for production."
        : "Gemini API key is not configured. Please check server environment settings.",
    });
  }

  let model = DEFAULT_MODEL;

  try {
    const config = getOllamaConfig();
    model = config.model;

    const response = await fetch(
      `${config.ollamaBaseUrl}/api/tags`,
      {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          status: "offline",
          provider: "ollama",
          model,
          modelAvailable: false,
          message: `Ollama returned HTTP ${response.status}.`,
        },
        { status: 503 },
      );
    }

    let data: unknown;

    try {
      data = await response.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          status: "offline",
          provider: "ollama",
          model,
          modelAvailable: false,
          message: "Ollama returned an invalid response.",
        },
        { status: 503 },
      );
    }

    const models =
      typeof data === "object" &&
      data !== null &&
      "models" in data &&
      Array.isArray(data.models)
        ? data.models
        : [];

    const modelAvailable = models.some((item: unknown) => {
      if (typeof item !== "object" || item === null) {
        return false;
      }

      const entry = item as {
        name?: unknown;
        model?: unknown;
      };

      return entry.name === model || entry.model === model;
    });

    return NextResponse.json({
      success: true,
      status: "online",
      provider: "ollama",
      model,
      modelAvailable,
      message: modelAvailable
        ? "Ollama is reachable and the configured model is installed."
        : "Ollama is reachable, but the configured model was not found.",
    });
  } catch (error) {
    const message =
      error instanceof Error &&
      error.message === "Invalid Ollama URL configuration."
        ? "Invalid Ollama URL configuration."
        : error instanceof Error &&
            error.message === "Invalid Ollama model configuration."
          ? "Invalid Ollama model configuration."
          : "Cannot reach Ollama. Check that the Ollama application is running.";

    return NextResponse.json(
      {
        success: false,
        status: "offline",
        provider: "ollama",
        model,
        modelAvailable: false,
        message,
      },
      { status: 503 },
    );
  }
}
