
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { validateRequestOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status },
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function verifyEventOwnership(eventId: string, userId: string) {
  return prisma.event.findFirst({
    where: { id: eventId, userId },
    select: { id: true, budget: true },
  });
}

// GET: Fetch budget items
export async function GET(
  _request: NextRequest,
  { params }: RouteContext,
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Unauthorized. Please login.", 401);
    }

    const { id } = await params;

    if (!id?.trim()) {
      return errorResponse("Event id is required.", 400);
    }

    const event = await prisma.event.findFirst({
      where: { id, userId: user.id },
      include: {
        budgetItems: {
          orderBy: { category: "asc" },
        },
      },
    });

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const totalAllocated = event.budgetItems.reduce(
      (sum, item) => sum + item.amount,
      0,
    );

    return NextResponse.json({
      success: true,
      items: event.budgetItems,
      eventBudget: event.budget,
      totalAllocated,
      remaining: event.budget - totalAllocated,
    });
  } catch (error) {
    console.error("GET budget error:", error);
    return errorResponse("Failed to fetch budget items.", 500);
  }
}

// POST: Create or update a budget category
export async function POST(
  request: NextRequest,
  { params }: RouteContext,
) {
  try {
    const originError = validateRequestOrigin(request);
    if (originError) return originError;

    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Unauthorized. Please login.", 401);
    }

    const { id } = await params;

    if (!id?.trim()) {
      return errorResponse("Event id is required.", 400);
    }

    const contentLength = Number(
      request.headers.get("content-length") ?? 0,
    );

    if (contentLength > 10 * 1024) {
      return errorResponse("Request body is too large.", 413);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON request body.", 400);
    }

    if (!isObject(body)) {
      return errorResponse("Request body must be a JSON object.", 400);
    }

    if (typeof body.category !== "string") {
      return errorResponse("Category must be a string.", 400);
    }

    const category = body.category.trim();
    const amount = body.amount;

    if (!category || category.length > 80) {
      return errorResponse(
        "Category is required and must be at most 80 characters.",
        400,
      );
    }

    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > 100000000
    ) {
      return errorResponse(
        "Amount must be a non-negative whole number up to 100000000 INR.",
        400,
      );
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const item = await prisma.$transaction(async (tx) => {
      // Recheck ownership and latest event budget inside transaction.
      const currentEvent = await tx.event.findFirst({
        where: {
          id,
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
        where: { eventId: id },
        select: {
          category: true,
          amount: true,
        },
      });

      const currentTotal = currentItems.reduce(
        (sum, current) => sum + current.amount,
        0,
      );

      const currentCategory = currentItems.find(
        (current) => current.category === category,
      );

      const previousAmount = currentCategory?.amount ?? 0;
      const newTotal = currentTotal - previousAmount + amount;

      if (newTotal > currentEvent.budget) {
        throw new Error("BUDGET_LIMIT_EXCEEDED");
      }

      return tx.budgetItem.upsert({
        where: {
          eventId_category: {
            eventId: id,
            category,
          },
        },
        create: {
          eventId: id,
          category,
          amount,
        },
        update: {
          amount,
        },
      });
    });

    const updatedEvent = await verifyEventOwnership(id, user.id);

    if (!updatedEvent) {
      return errorResponse("Event not found.", 404);
    }

    const updatedAllocation = await prisma.budgetItem.aggregate({
      where: { eventId: id },
      _sum: { amount: true },
    });

    const updatedTotal = updatedAllocation._sum.amount ?? 0;

    return NextResponse.json({
      success: true,
      item,
      totalAllocated: updatedTotal,
      remaining: updatedEvent.budget - updatedTotal,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "BUDGET_LIMIT_EXCEEDED") {
        return errorResponse(
          "The allocation exceeds the event's total budget. Refresh the budget and try again.",
          400,
        );
      }

      if (error.message === "EVENT_NOT_FOUND") {
        return errorResponse("Event not found.", 404);
      }
    }

    console.error("POST budget error:", error);
    return errorResponse("Failed to save budget item.", 500);
  }
}

// DELETE: Delete a category using ?category=Venue
export async function DELETE(
  request: NextRequest,
  { params }: RouteContext,
) {
  try {
    const originError = validateRequestOrigin(request);
    if (originError) return originError;

    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Unauthorized. Please login.", 401);
    }

    const { id } = await params;
    const category = request.nextUrl.searchParams
      .get("category")
      ?.trim();

    if (!id?.trim()) {
      return errorResponse("Event id is required.", 400);
    }

    if (!category || category.length > 80) {
      return errorResponse(
        "Provide a valid category query parameter.",
        400,
      );
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const result = await prisma.budgetItem.deleteMany({
      where: {
        eventId: id,
        category,
      },
    });

    if (result.count === 0) {
      return errorResponse("Budget category not found.", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Budget category deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE budget error:", error);
    return errorResponse("Failed to delete budget item.", 500);
  }
}
