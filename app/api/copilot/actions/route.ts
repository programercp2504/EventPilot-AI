import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { validateRequestOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 30_000;
const MAX_PLAN_SIZE = 20_000;




type Operation =
  | {
      kind: "add_task";
      title: string;
      category: string;
    }
  | {
      kind: "update_budget";
      category: string;
      amount: number;
    }
  | {
      kind: "update_plan";
      data: string;
    };

function text(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { success: false, error },
    { status }
  );
}

function validatePlanData(value: unknown): boolean {
  if (!isObject(value)) return false;

  let nodes = 0;

  function visit(current: unknown, depth: number): boolean {
    nodes++;

    if (nodes > 3000 || depth > 12) return false;

    if (
      current === null ||
      typeof current === "boolean"
    ) {
      return true;
    }

    if (typeof current === "string") {
      return current.length <= 5000;
    }

    if (typeof current === "number") {
      return Number.isFinite(current);
    }

    if (Array.isArray(current)) {
      if (current.length > 500) return false;

      return current.every((item) =>
        visit(item, depth + 1)
      );
    }

    if (isObject(current)) {
      const entries = Object.entries(current);

      if (entries.length > 300) return false;

      return entries.every(([key, item]) => {
        return (
          key.length > 0 &&
          key.length <= 100 &&
          visit(item, depth + 1)
        );
      });
    }

    return false;
  }

  return visit(value, 0);
}

export async function POST(request: NextRequest) {
  // 1. Validate request origin.
  const originError = validateRequestOrigin(request);

  if (originError) {
    return originError;
  }

  try {
    // 2. Authenticate user.
    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Please login to continue.", 401);
    }

    // 3. Check request size before parsing.
    const contentLength = Number(
      request.headers.get("content-length") || 0
    );

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_BODY_SIZE
    ) {
      return errorResponse("Request body is too large.", 413);
    }

    const rawBody = await request.text();

    if (rawBody.length > MAX_BODY_SIZE) {
      return errorResponse("Request body is too large.", 413);
    }

    // 4. Parse JSON safely.
    let body: unknown;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("Invalid JSON request body.", 400);
    }

    if (!isObject(body)) {
      return errorResponse("Invalid request body.", 400);
    }

    const eventId = text(body.eventId, 100);
    const mode = body.mode;
    const action = body.action;

    if (!eventId) {
      return errorResponse("eventId is required.", 400);
    }

    if (mode !== "preview" && mode !== "apply") {
      return errorResponse(
        "mode must be preview or apply.",
        400
      );
    }

    if (!isObject(action)) {
      return errorResponse("A valid action is required.", 400);
    }

    // 5. Verify event ownership.
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        budget: true,
      },
    });

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const type = action.type;

    if (
      type !== "add_task" &&
      type !== "update_budget" &&
      type !== "update_plan"
    ) {
      return errorResponse("Unsupported action type.", 400);
    }

    let operation: Operation;
    let preview: Record<string, unknown>;

    // 6. Validate and prepare action.
    if (type === "add_task") {
      const title = text(action.title, 160);
      const category =
        text(action.category, 60) || "General";

      if (!title) {
        return errorResponse("Task title is required.", 400);
      }

      operation = {
        kind: "add_task",
        title,
        category,
      };

      preview = {
        type,
        title,
        category,
        description: "Add a new checklist task to this event.",
      };
    } else if (type === "update_budget") {
      const category = text(action.category, 80);
      const amount = action.amount;

      if (
        !category ||
        typeof action.category !== "string" ||
        action.category.trim().length > 80 ||
        typeof amount !== "number" ||
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        amount > event.budget
      ) {
        return errorResponse(
          "Enter a valid category and a whole-number amount between 0 and the event budget.",
          400
        );
      }

      operation = {
        kind: "update_budget",
        category,
        amount,
      };

      preview = {
        type,
        category,
        amount,
        description:
          "Set the saved allocation for this budget category.",
      };
    } else {
      if (!validatePlanData(action.planData)) {
        return errorResponse(
          "planData must be a valid JSON object within the allowed size and nesting limits.",
          400
        );
      }

      let serialized: string;

      try {
        serialized = JSON.stringify(action.planData);
      } catch {
        return errorResponse("Invalid plan data.", 400);
      }

      if (serialized.length > MAX_PLAN_SIZE) {
        return errorResponse("Plan data is too large.", 400);
      }

      operation = {
        kind: "update_plan",
        data: serialized,
      };

      preview = {
        type,
        description: "Replace the saved event plan data.",
        planData: action.planData,
      };
    }

    // 7. Preview never modifies the database.
    if (mode === "preview") {
      return NextResponse.json({
        success: true,
        mode: "preview",
        event: {
          id: event.id,
          name: event.name,
        },
        preview,
        confirmationRequired: true,
      });
    }

    // 8. Apply the approved action.
    let result: unknown;

    if (operation.kind === "add_task") {
      result = await prisma.checklistItem.create({
        data: {
          eventId,
          title: operation.title,
          category: operation.category,
        },
      });
    } else if (operation.kind === "update_budget") {
      result = await prisma.$transaction(async (tx) => {
        // Recheck ownership and latest budget inside transaction.
        const currentEvent = await tx.event.findFirst({
          where: {
            id: eventId,
            userId: user.id,
          },
          select: {
            id: true,
            budget: true,
          },
        });

        if (!currentEvent) {
          throw new Error("EVENT_NOT_FOUND");
        }

        const currentItems = await tx.budgetItem.findMany({
          where: { eventId },
          select: {
            category: true,
            amount: true,
          },
        });

        const currentTotal = currentItems.reduce(
          (sum, item) => sum + item.amount,
          0
        );

        const existingItem = currentItems.find(
          (item) => item.category === operation.category
        );

        const previousAmount = existingItem?.amount ?? 0;

        const newTotal =
          currentTotal -
          previousAmount +
          operation.amount;

        if (newTotal > currentEvent.budget) {
          throw new Error("BUDGET_LIMIT_EXCEEDED");
        }

        return tx.budgetItem.upsert({
          where: {
            eventId_category: {
              eventId,
              category: operation.category,
            },
          },
          create: {
            eventId,
            category: operation.category,
            amount: operation.amount,
          },
          update: {
            amount: operation.amount,
          },
        });
      });
    } else {
      result = await prisma.$transaction(async (tx) => {
        const currentEvent = await tx.event.findFirst({
          where: {
            id: eventId,
            userId: user.id,
          },
          select: { id: true },
        });

        if (!currentEvent) {
          throw new Error("EVENT_NOT_FOUND");
        }

        return tx.eventPlan.upsert({
          where: { eventId },
          create: {
            eventId,
            data: operation.data,
          },
          update: {
            data: operation.data,
          },
        });
      });
    }

    return NextResponse.json({
      success: true,
      mode: "applied",
      message: "Action applied successfully.",
      result,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "BUDGET_LIMIT_EXCEEDED"
    ) {
      return errorResponse(
        "This change would exceed the event's total budget. Reduce another allocation or choose a smaller amount.",
        400
      );
    }

    if (
      error instanceof Error &&
      error.message === "EVENT_NOT_FOUND"
    ) {
      return errorResponse("Event not found.", 404);
    }

    console.error("Co-Pilot action error:", error);

    return errorResponse(
      "Could not process the action.",
      500
    );
  }
}