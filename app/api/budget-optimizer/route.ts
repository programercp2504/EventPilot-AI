
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { validateRequestOrigin } from "@/lib/security";
import { generateAiText } from "@/lib/ai-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Recommendation = {
  category: string;
  currentAmount: number;
  suggestedAmount: number;
  rationale: string;
  savingsTip: string;
};

type Optimization = {
  summary: string;
  totalBudget: number;
  currentAllocated: number;
  suggestedTotal: number;
  recommendations: Recommendation[];
  engine: "rules" | "gemini" | "ollama";
  warnings: string[];
};

type EventBudgetContext = {
  name: string;
  type: string;
  guests: number;
  budget: number;
  budgetItems: { category: string; amount: number }[];
};

const MAX_BODY_BYTES = 10 * 1024;
const MAX_EVENT_ID_LENGTH = 200;
const MAX_AI_RESPONSE_LENGTH = 64 * 1024;
const AI_TIMEOUT_MS = 45_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status },
  );
}

async function readLimitedBody(
  request: NextRequest,
): Promise<string | null> {
  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let result = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      totalBytes += value.byteLength;

      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }

      result += decoder.decode(value, { stream: true });
    }

    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

function makeFallback(event: EventBudgetContext): Optimization {
  const currentAllocated = event.budgetItems.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  const aliases = [
    {
      names: ["venue", "hall", "location"],
      label: "Venue",
      share: 0.2,
      tip: "Compare community halls and off-peak venue packages.",
    },
    {
      names: ["food", "catering", "food & catering"],
      label: "Food & Catering",
      share: 0.35,
      tip: "Use a fixed menu and confirm the per-guest rate.",
    },
    {
      names: ["decoration", "decor"],
      label: "Decoration",
      share: 0.1,
      tip: "Reuse decorations and prioritize a few focal areas.",
    },
    {
      names: ["photography", "photo"],
      label: "Photography",
      share: 0.1,
      tip: "Compare package hours and avoid unnecessary add-ons.",
    },
    {
      names: ["entertainment", "music", "dj"],
      label: "Entertainment",
      share: 0.08,
      tip: "Choose one main entertainment option.",
    },
    {
      names: ["miscellaneous", "other", "transport", "gifts"],
      label: "Other",
      share: 0.07,
      tip: "Set a limit for optional purchases.",
    },
  ];

  const recommendations: Recommendation[] = aliases.map((group) => {
    const matchingItems = event.budgetItems.filter((item) =>
      group.names.includes(item.category.toLowerCase()),
    );

    const currentAmount = matchingItems.reduce(
      (sum, item) => sum + item.amount,
      0,
    );

    return {
      category: matchingItems[0]?.category ?? group.label,
      currentAmount,
      suggestedAmount: Math.round(event.budget * group.share),
      rationale: `A starting estimate for ${event.guests} guests. Compare it with local prices before applying.`,
      savingsTip: group.tip,
    };
  });

  for (const item of event.budgetItems) {
    if (
      !recommendations.some(
        (rec) =>
          rec.category.toLowerCase() === item.category.toLowerCase(),
      )
    ) {
      recommendations.push({
        category: item.category,
        currentAmount: item.amount,
        suggestedAmount: item.amount,
        rationale: "This is a custom category already in your saved budget.",
        savingsTip: "Review whether this expense is essential.",
      });
    }
  }

  let remaining = Math.round(event.budget * 0.9);

  const capped = recommendations.map((rec) => {
    const amount = Math.max(0, Math.min(rec.suggestedAmount, remaining));
    remaining -= amount;
    return { ...rec, suggestedAmount: amount };
  });

  return {
    summary: `Budget review for ${event.name}. Keep at least 10% of your budget available for unexpected expenses where practical.`,
    totalBudget: event.budget,
    currentAllocated,
    suggestedTotal: capped.reduce(
      (sum, item) => sum + item.suggestedAmount,
      0,
    ),
    recommendations: capped,
    engine: "rules",
    warnings: [
      "These are estimates, not verified vendor prices.",
      ...(currentAllocated > event.budget
        ? ["Your current allocations exceed the event budget."]
        : []),
    ],
  };
}

function parseRecommendations(
  content: string,
  fallback: Optimization,
  engine: "gemini" | "ollama",
): Optimization {
  try {
    if (
      typeof content !== "string" ||
      content.length === 0 ||
      content.length > MAX_AI_RESPONSE_LENGTH
    ) {
      return fallback;
    }

    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed: unknown = JSON.parse(cleaned);

    if (!isRecord(parsed) || !Array.isArray(parsed.recommendations)) {
      return fallback;
    }

    const aiRecommendations = parsed.recommendations;

    const recommendations = fallback.recommendations.map((base) => {
      const ai = aiRecommendations.find(
        (item: unknown) =>
          isRecord(item) &&
          typeof item.category === "string" &&
          item.category.toLowerCase() === base.category.toLowerCase(),
      );

      if (!isRecord(ai)) return base;

      const amount = ai.suggestedAmount;

      const validAmount =
        typeof amount === "number" &&
        Number.isSafeInteger(amount) &&
        amount >= 0;

      return {
        ...base,
        suggestedAmount: validAmount
          ? Math.min(amount, fallback.totalBudget)
          : base.suggestedAmount,
        rationale:
          typeof ai.rationale === "string" && ai.rationale.length <= 500
            ? ai.rationale
            : base.rationale,
        savingsTip:
          typeof ai.savingsTip === "string" && ai.savingsTip.length <= 500
            ? ai.savingsTip
            : base.savingsTip,
      };
    });

    // Enforce the 90% budget cap after AI recommendations.
    let remaining = Math.round(fallback.totalBudget * 0.9);

    const limited = recommendations.map((item) => {
      const suggestedAmount = Math.min(item.suggestedAmount, remaining);
      remaining -= suggestedAmount;

      return { ...item, suggestedAmount };
    });

    return {
      ...fallback,
      summary:
        typeof parsed.summary === "string" && parsed.summary.length <= 1000
          ? parsed.summary
          : fallback.summary,
      suggestedTotal: limited.reduce(
        (sum, item) => sum + item.suggestedAmount,
        0,
      ),
      recommendations: limited,
      engine,
    };
  } catch {
    return fallback;
  }
}

async function getAiOptimization(
  context: EventBudgetContext,
  fallback: Optimization,
): Promise<Optimization> {
  try {
    const result = await generateAiText({
      systemPrompt: [
        "You are an event budget advisor.",
        "Return only valid JSON with keys summary and recommendations.",
        "For every supplied category, return category, suggestedAmount as a whole number in INR, rationale, and savingsTip.",
        "Keep all categories exactly as supplied.",
        "Never add or remove categories.",
        "Keep the total recommendations within 90% of the total budget.",
        "Use practical estimates, not claimed live prices.",
        "Do not invent vendor quotes or verified market prices.",
      ].join(" "),
      userPrompt: JSON.stringify({
        event: {
          name: context.name,
          type: context.type,
          guests: context.guests,
          totalBudgetINR: context.budget,
          currentAllocations: context.budgetItems,
        },
        allowedRecommendations: fallback.recommendations,
      }),
      temperature: 0.2,
      maxOutputTokens: 900,
      json: true,
      timeoutMs: AI_TIMEOUT_MS,
    });

    if (!result?.text) return fallback;

    return parseRecommendations(
      result.text,
      fallback,
      result.engine,
    );
  } catch (error) {
    console.error("Budget AI optimization failed:", error);
    return fallback;
  }
}

export async function POST(request: NextRequest) {
  try {
    const originError = validateRequestOrigin(request);
    if (originError) return originError;

    const contentLengthHeader = request.headers.get("content-length");

    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);

      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        return errorResponse("Invalid content length.", 400);
      }

      if (contentLength > MAX_BODY_BYTES) {
        return errorResponse("Request body is too large.", 413);
      }
    }

    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Please login to continue.", 401);
    }

    let body: unknown;

    try {
      const rawBody = await readLimitedBody(request);

      if (rawBody === null) {
        return errorResponse("Request body is required.", 400);
      }

      body = JSON.parse(rawBody);
    } catch (error) {
      if (error instanceof Error && error.message === "BODY_TOO_LARGE") {
        return errorResponse("Request body is too large.", 413);
      }

      return errorResponse(
        "Request body must contain valid JSON.",
        400,
      );
    }

    if (!isRecord(body)) {
      return errorResponse(
        "Request body must be a JSON object.",
        400,
      );
    }

    if (
      typeof body.eventId !== "string" ||
      !body.eventId.trim() ||
      body.eventId.length > MAX_EVENT_ID_LENGTH
    ) {
      return errorResponse("Invalid event ID.", 400);
    }

    const eventId = body.eventId.trim();

    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        userId: user.id,
      },
      include: {
        budgetItems: true,
      },
    });

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const budget = Number(event.budget);
    const guests = Number(event.guests);

    if (!Number.isSafeInteger(budget) || budget <= 0) {
      return errorResponse(
        "Event budget must be greater than zero.",
        400,
      );
    }

    if (
      !Number.isSafeInteger(guests) ||
      guests < 1 ||
      guests > 5000
    ) {
      return errorResponse("Event guest count is invalid.", 400);
    }

    const budgetItems = event.budgetItems.map((item) => ({
      category: item.category,
      amount: Number(item.amount),
    }));

    if (
      budgetItems.some(
        (item) =>
          typeof item.category !== "string" ||
          item.category.trim().length === 0 ||
          item.category.length > 100 ||
          !Number.isSafeInteger(item.amount) ||
          item.amount < 0,
      )
    ) {
      return errorResponse(
        "Saved budget allocations contain invalid data.",
        400,
      );
    }

    const context: EventBudgetContext = {
      name: event.name,
      type: event.type,
      guests,
      budget,
      budgetItems,
    };

    const fallback = makeFallback(context);
    const optimization = await getAiOptimization(context, fallback);

    return NextResponse.json({
      success: true,
      optimization,
    });
  } catch (error) {
    console.error("Budget optimizer error:", error);

    return errorResponse(
      "Unable to optimize the budget. Check the server terminal for details.",
      500,
    );
  }
}
