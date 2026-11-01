
import { NextRequest, NextResponse } from "next/server";
import { validateRequestOrigin } from "@/lib/security";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { generateAiText } from "@/lib/ai-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlanningEvent = {
  name: string;
  type: string;
  date: string;
  guests: number;
  budget: number;
};

type AiIdeas = {
  summary?: string;
  theme?: string;
  colorPalette?: string[];
  decoration?: string[];
  food?: string[];
  entertainment?: string[];
  savingsTips?: string[];
  ideas?: string[];
  notes?: string[];
};

type AiEngine = "gemini" | "ollama" | "rule-based-fallback";

const MAX_NAME_LENGTH = 120;
const MAX_TYPE_LENGTH = 60;
const MAX_BUDGET = 100_000_000;
const MAX_GUESTS = 5000;

const DEFAULT_IDEAS = {
  decoration: [
    "Use one focal backdrop instead of decorating every wall.",
    "Combine reusable fabric, warm lighting, and a few floral accents.",
    "Use coordinated signage to make the venue easy to navigate.",
  ],
  food: [
    "Offer vegetarian options and label common allergens.",
    "Confirm portions and dietary requirements with the caterer.",
    "Keep drinking water and non-alcoholic refreshments accessible.",
  ],
  entertainment: [
    "Create a playlist suited to the event and audience.",
    "Add a photo corner or guest-message activity.",
    "Use a simple schedule to keep key moments on time.",
  ],
  savingsTips: [
    "Reserve 8–10% of the budget for unexpected costs.",
    "Prioritise guest comfort, food, and one standout feature.",
    "Compare itemised vendor quotes before making commitments.",
  ],
  ideas: [
    "Create a welcome sign featuring the event name.",
    "Share a digital itinerary with guests.",
    "Plan one memorable group activity or photo moment.",
  ],
  notes: [
    "Suggestions are estimates, not live vendor quotes.",
    "Confirm availability, accessibility, weather backup, and venue rules.",
  ],
} satisfies Required<
  Pick<
    AiIdeas,
    | "decoration"
    | "food"
    | "entertainment"
    | "savingsTips"
    | "ideas"
    | "notes"
  >
>;

function text(
  value: unknown,
  fallback = "",
  maxLength = 1000,
): string {
  if (typeof value !== "string") return fallback;

  const result = value.trim().slice(0, maxLength);
  return result || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (year < 1900 || year > 2200) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function stringArray(
  value: unknown,
  fallback: string[],
  maxItems = 5,
): string[] {
  if (!Array.isArray(value)) return [...fallback];

  const result = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, maxItems);

  return result.length ? result : [...fallback];
}

function makeBudget(budget: number, type: string) {
  const lower = type.toLowerCase();

  const categories: readonly (readonly [string, number])[] =
    lower.includes("wedding")
      ? [
          ["Venue & setup", 0.30],
          ["Food & catering", 0.28],
          ["Decoration & flowers", 0.15],
          ["Photography", 0.10],
          ["Entertainment", 0.07],
          ["Attire & miscellaneous", 0.10],
        ]
      : lower.includes("birthday")
        ? [
            ["Venue", 0.20],
            ["Food & cake", 0.30],
            ["Decoration", 0.15],
            ["Entertainment", 0.15],
            ["Photography", 0.08],
            ["Contingency & other", 0.12],
          ]
        : [
            ["Venue & setup", 0.25],
            ["Food & catering", 0.30],
            ["Decoration", 0.12],
            ["Audio-visual & entertainment", 0.13],
            ["Photography & media", 0.08],
            ["Contingency & other", 0.12],
          ];

  let allocated = 0;

  return categories.map(([category, fraction], index) => {
    const amount =
      index === categories.length - 1
        ? budget - allocated
        : Math.round(budget * fraction);

    allocated += amount;

    return {
      category,
      amount,
      percent:
        budget > 0
          ? Math.round((amount / budget) * 100)
          : 0,
    };
  });
}

function makeTimeline(dateString: string, type: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  const eventDay = new Date(Date.UTC(year, month - 1, day));

  const today = new Date();
  const todayUTC = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const eventTimestamp = eventDay.getTime();
  const daysUntilEvent = Math.round(
    (eventTimestamp - todayUTC) / 86_400_000,
  );

  if (daysUntilEvent < 0) {
    return [
      {
        date: dateString,
        time: "Past event",
        daysBeforeEvent: daysUntilEvent,
        task: `This ${type.toLowerCase()} was scheduled for ${dateString}. Choose a new event date to create a future planning timeline.`,
        priority: "Low",
      },
    ];
  }

  const milestones = [
    {
      days: 56,
      task: "Confirm event goals, guest list, budget, and preferred style.",
      priority: "High",
    },
    {
      days: 42,
      task: "Compare venues and request quotes from essential vendors.",
      priority: "High",
    },
    {
      days: 28,
      task: "Confirm the venue, key vendors, and event theme.",
      priority: "High",
    },
    {
      days: 14,
      task: "Finalise guest numbers, catering, decoration, and logistics.",
      priority: "Medium",
    },
    {
      days: 7,
      task: "Reconfirm vendor bookings, payments, and the event schedule.",
      priority: "High",
    },
    {
      days: 1,
      task: "Prepare final materials and confirm setup arrangements.",
      priority: "High",
    },
    {
      days: 0,
      task: "Set up the venue and complete final event-day checks.",
      priority: "High",
    },
  ];

  return milestones
    .filter((item) => item.days <= daysUntilEvent)
    .map((item) => {
      const milestoneDate = new Date(eventTimestamp);
      milestoneDate.setUTCDate(
        milestoneDate.getUTCDate() - item.days,
      );

      return {
        date: milestoneDate.toISOString().slice(0, 10),
        time:
          item.days === 0
            ? "Event day"
            : `${item.days} days before`,
        daysBeforeEvent: item.days,
        task: item.task,
        priority: item.priority,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function makeChecklist(type: string, guests: number) {
  return [
    "Confirm event goals, guest count, and spending limit",
    "Shortlist venues and confirm availability",
    "Confirm food preferences, dietary needs, and catering quantities",
    "Book decoration and essential vendors",
    "Arrange sound, lighting, and entertainment requirements",
    "Prepare invitations and guest communication",
    `Plan seating and guest flow for approximately ${guests} attendees`,
    `Prepare a final ${type.toLowerCase()}-day schedule and vendor contact list`,
    "Keep a contingency reserve and confirm payment deadlines",
  ];
}

function fallbackIdeas(event: PlanningEvent): AiIdeas {
  const type = event.type.toLowerCase();
  const wedding = type.includes("wedding");
  const birthday = type.includes("birthday");

  return {
    summary: `A practical ${type} plan for ${event.guests} guests, designed around a ₹${event.budget.toLocaleString("en-IN")} budget. Confirm local prices and vendor availability before booking.`,
    theme: wedding
      ? "An elegant celebration with coordinated florals, soft lighting, and a welcoming guest experience."
      : birthday
        ? "A joyful, photo-friendly celebration with a cohesive colour palette and a memorable cake reveal."
        : "A cohesive event concept with clear signage, comfortable guest flow, and a balanced schedule.",
    colorPalette: wedding
      ? ["Ivory", "Sage green", "Champagne gold", "Blush pink"]
      : birthday
        ? ["Lavender", "Cream", "Coral", "Gold"]
        : ["Navy", "White", "Teal", "Warm amber"],
    ...DEFAULT_IDEAS,
  };
}

function parseAiContent(content: unknown): AiIdeas | null {
  if (typeof content !== "string") return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");

    if (start < 0 || end <= start) return null;

    try {
      parsed = JSON.parse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  if (!isRecord(parsed)) return null;

  if (
    typeof parsed.summary !== "string" &&
    typeof parsed.theme !== "string" &&
    !Array.isArray(parsed.ideas)
  ) {
    return null;
  }

  return parsed as AiIdeas;
}

async function getAiIdeas(
  event: PlanningEvent,
): Promise<{
  ideas: AiIdeas | null;
  engine: AiEngine;
}> {
  const result = await generateAiText({
    systemPrompt:
      "You are EventPilot AI, a practical event planner. Return only valid JSON with keys summary, theme, colorPalette, decoration, food, entertainment, savingsTips, ideas, notes. summary and theme must be strings. All other keys must be arrays of short strings. Give specific, realistic suggestions suited to the event type, guest count, date, and budget. Treat all budgets as INR. Never claim live prices, vendor availability, or bookings. Keep arrays to 3-5 useful items. Do not generate budgetBreakdown, timeline, or checklist; those are calculated separately.",
    userPrompt: JSON.stringify({
      eventName: event.name,
      eventType: event.type,
      eventDate: event.date,
      guests: event.guests,
      budgetINR: event.budget,
      request:
        "Create a personalised event concept, colour palette, decoration, catering, entertainment, budget-saving tips, and additional feasible ideas. Avoid repetitive suggestions.",
    }),
    temperature: 0.7,
    maxOutputTokens: 1500,
    json: true,
    timeoutMs: 45_000,
  });

  if (!result) {
    return {
      ideas: null,
      engine: "rule-based-fallback",
    };
  }

  const ideas = parseAiContent(result.text);

  if (!ideas) {
    return {
      ideas: null,
      engine: "rule-based-fallback",
    };
  }

  return {
    ideas,
    engine: result.engine,
  };
}

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    { status },
  );
}

// GET /api/plan?eventId=...
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Unauthorized. Please login.", 401);
    }

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId")?.trim();

    if (!eventId) {
      return errorResponse(
        "eventId query parameter is required.",
        400,
      );
    }

    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        userId: user.id,
      },
      select: { id: true },
    });

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const saved = await prisma.eventPlan.findFirst({
      where: { eventId: event.id },
      select: { data: true, updatedAt: true },
    });

    if (!saved) {
      return NextResponse.json({
        success: true,
        plan: null,
      });
    }

    let plan: unknown;

    try {
      plan = JSON.parse(saved.data);
    } catch {
      console.error(
        "Saved event plan contains invalid JSON for event:",
        eventId,
      );

      return errorResponse(
        "The saved plan is corrupted. Generate it again.",
        500,
      );
    }

    return NextResponse.json({
      success: true,
      plan,
      updatedAt: saved.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("GET /api/plan failed:", error);

    return errorResponse(
      "Could not load the saved plan.",
      500,
    );
  }
}

// POST /api/plan
export async function POST(request: NextRequest) {
  try {
    const originError = validateRequestOrigin(request);

    if (originError) return originError;

    const contentLength = Number(
      request.headers.get("content-length") || 0,
    );

    if (contentLength > 10 * 1024) {
      return errorResponse("Request body is too large.", 413);
    }

    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Unauthorized. Please login.", 401);
    }

    let body: unknown;

    try {
      const rawBody = await request.text();

      if (new TextEncoder().encode(rawBody).length > 10 * 1024) {
        return errorResponse("Request body is too large.", 413);
      }

      body = JSON.parse(rawBody);
    } catch {
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

    const name = text(body.name, "", MAX_NAME_LENGTH);
    const type = text(body.type, "", MAX_TYPE_LENGTH);
    const date = text(body.date, "", 10);
    const guests = body.guests;
    const budget = body.budget;

    if (!name || !type || !date) {
      return errorResponse(
        "Event name, type, and date are required.",
        400,
      );
    }

    if (
      typeof guests !== "number" ||
      !Number.isInteger(guests) ||
      guests < 1 ||
      guests > MAX_GUESTS
    ) {
      return errorResponse(
        "Guests must be a whole number from 1 to 5,000.",
        400,
      );
    }

    if (
      typeof budget !== "number" ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > MAX_BUDGET
    ) {
      return errorResponse(
        "Budget must be a whole number from ₹1 to ₹10 crore.",
        400,
      );
    }

    if (!isValidDateOnly(date)) {
      return errorResponse(
        "Please provide a valid date in YYYY-MM-DD format.",
        400,
      );
    }

    const event: PlanningEvent = {
      name,
      type,
      date,
      guests,
      budget,
    };

    const eventId =
      typeof body.id === "string" ? body.id.trim() : "";

    if (eventId.length > 200) {
      return errorResponse("Invalid event ID.", 400);
    }

    // If an event ID is supplied, it must belong to the logged-in user.
    if (eventId) {
      const existingEvent = await prisma.event.findFirst({
        where: {
          id: eventId,
          userId: user.id,
        },
        select: {
          id: true,
          name: true,
          type: true,
          date: true,
          guests: true,
          budget: true,
        },
      });

      if (!existingEvent) {
        return errorResponse("Event not found.", 404);
      }

      // Use trusted database values instead of client-supplied event details.
      event.name = existingEvent.name;
      event.type = existingEvent.type;
      event.date = existingEvent.date;
      event.guests = existingEvent.guests;
      event.budget = existingEvent.budget;
    }

    const fallback = fallbackIdeas(event);
    const aiResult = await getAiIdeas(event);
    const ai = aiResult.ideas;

    const merged: AiIdeas = ai
      ? {
          summary: text(ai.summary, fallback.summary, 1000),
          theme: text(ai.theme, fallback.theme, 1000),
          colorPalette: stringArray(
            ai.colorPalette,
            fallback.colorPalette!,
            6,
          ),
          decoration: stringArray(
            ai.decoration,
            fallback.decoration!,
            5,
          ),
          food: stringArray(
            ai.food,
            fallback.food!,
            5,
          ),
          entertainment: stringArray(
            ai.entertainment,
            fallback.entertainment!,
            5,
          ),
          savingsTips: stringArray(
            ai.savingsTips,
            fallback.savingsTips!,
            5,
          ),
          ideas: stringArray(
            ai.ideas,
            fallback.ideas!,
            5,
          ),
          notes: stringArray(
            ai.notes,
            fallback.notes!,
            4,
          ),
        }
      : fallback;

    const plan = {
      summary: merged.summary,
      budgetBreakdown: makeBudget(event.budget, event.type),
      timeline: makeTimeline(event.date, event.type),
      checklist: makeChecklist(event.type, event.guests),
      ideas: merged.ideas,
      notes: merged.notes,
      theme: merged.theme,
      colorPalette: merged.colorPalette,
      decoration: merged.decoration,
      food: merged.food,
      entertainment: merged.entertainment,
      savingsTips: merged.savingsTips,
    };

    if (eventId) {
      await prisma.eventPlan.upsert({
        where: { eventId },
        create: {
          eventId,
          data: JSON.stringify(plan),
        },
        update: {
          data: JSON.stringify(plan),
        },
      });
    }

    return NextResponse.json({
      success: true,
      plan,
      meta: {
        engine: ai
          ? `${aiResult.engine}-${process.env.VERCEL === "1" ? "production" : "local"}`
          : "rule-based-fallback",
        eventId: eventId ? eventId.slice(0, 200) : null,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("POST /api/plan failed:", error);

    return errorResponse(
      "Could not generate the event plan. Please try again.",
      500,
    );
  }
}
