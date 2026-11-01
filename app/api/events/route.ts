import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { validateRequestOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validateEvent(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type =
    typeof body.type === "string" && body.type.trim()
      ? body.type.trim()
      : "Other";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const guests = Number(body.guests);
  const budget = Number(body.budget);

  if (!name || name.length > 120) {
    return { error: "Event name must be between 1 and 120 characters." };
  }

  // Strict YYYY-MM-DD calendar date validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Please provide a valid event date." };
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return { error: "Please provide a valid event date." };
  }

  if (!Number.isInteger(guests) || guests < 1 || guests > 5000) {
    return { error: "Guests must be between 1 and 5000." };
  }

  if (
    !Number.isSafeInteger(budget) ||
    budget < 0 ||
    budget > 100000000
  ) {
    return { error: "Budget must be between 0 and 100000000 INR." };
  }

  return {
    data: { name, type: type.slice(0, 80), date, guests, budget },
  };
}

function isValidBody(
  body: unknown
): body is Record<string, unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body)
  );
}

// GET: Only return events belonging to the logged-in user.
export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please login." },
        { status: 401 }
      );
    }

    const events = await prisma.event.findMany({
      where: { userId: user.id },
      orderBy: [{ date: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      success: true,
      events,
      count: events.length,
    });
  } catch (error) {
    console.error("GET /api/events failed:", error);

    return NextResponse.json(
      { success: false, error: "Could not load events from the database." },
      { status: 500 }
    );
  }
}

// POST: Create an event.
export async function POST(request: NextRequest) {
  const originError = validateRequestOrigin(request);
  if (originError) return originError;

  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please login." },
        { status: 401 }
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);

    if (contentLength > 10_000) {
      return NextResponse.json(
        { success: false, error: "Request body is too large." },
        { status: 413 }
      );
    }

    const body: unknown = await request.json();

    if (!isValidBody(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const validated = validateEvent(body);

    if ("error" in validated) {
      return NextResponse.json(
        { success: false, error: validated.error },
        { status: 400 }
      );
    }

    const event = await prisma.event.create({
      data: {
        ...validated.data,
        userId: user.id,
      },
    });

    return NextResponse.json(
      { success: true, message: "Event created successfully.", event },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/events failed:", error);

    return NextResponse.json(
      { success: false, error: "Invalid request or database error while creating the event." },
      { status: 500 }
    );
  }
}

// PUT: Update only an event owned by the logged-in user.
export async function PUT(request: NextRequest) {
  const originError = validateRequestOrigin(request);
  if (originError) return originError;

  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please login." },
        { status: 401 }
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);

    if (contentLength > 10_000) {
      return NextResponse.json(
        { success: false, error: "Request body is too large." },
        { status: 413 }
      );
    }

    const body: unknown = await request.json();

    if (!isValidBody(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";

    if (!id || id.length > 100) {
      return NextResponse.json(
        { success: false, error: "A valid event id is required." },
        { status: 400 }
      );
    }

    const validated = validateEvent(body);

    if ("error" in validated) {
      return NextResponse.json(
        { success: false, error: validated.error },
        { status: 400 }
      );
    }

    // Ownership is included directly in the update condition.
    const result = await prisma.event.updateMany({
      where: {
        id,
        userId: user.id,
      },
      data: validated.data,
    });

    if (result.count === 0) {
      return NextResponse.json(
        { success: false, error: "Event not found." },
        { status: 404 }
      );
    }

    const event = await prisma.event.findFirst({
      where: { id, userId: user.id },
    });

    return NextResponse.json({
      success: true,
      message: "Event updated successfully.",
      event,
    });
  } catch (error) {
    console.error("PUT /api/events failed:", error);

    return NextResponse.json(
      { success: false, error: "Could not update event. Check the event id and request data." },
      { status: 500 }
    );
  }
}

// DELETE: Delete only an event owned by the logged-in user.
export async function DELETE(request: NextRequest) {
  const originError = validateRequestOrigin(request);
  if (originError) return originError;

  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized. Please login." },
        { status: 401 }
      );
    }

    const id = request.nextUrl.searchParams.get("id")?.trim();

    if (!id || id.length > 100) {
      return NextResponse.json(
        { success: false, error: "A valid event id is required in the URL." },
        { status: 400 }
      );
    }

    const result = await prisma.event.deleteMany({
      where: {
        id,
        userId: user.id,
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { success: false, error: "Event not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Event deleted successfully.",
      id,
    });
  } catch (error) {
    console.error("DELETE /api/events failed:", error);

    return NextResponse.json(
      { success: false, error: "Could not delete the event." },
      { status: 500 }
    );
  }
}