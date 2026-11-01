
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { validateRequestOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const MAX_BODY_SIZE = 10 * 1024;
const MAX_ID_LENGTH = 200;

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status },
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_ID_LENGTH
  );
}

async function parseBody(
  request: NextRequest,
): Promise<
  | { body: Record<string, unknown> }
  | { error: NextResponse }
> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    const length = Number(contentLength);

    if (!Number.isFinite(length) || length < 0) {
      return { error: errorResponse("Invalid content length.", 400) };
    }

    if (length > MAX_BODY_SIZE) {
      return { error: errorResponse("Request body is too large.", 413) };
    }
  }

  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_SIZE) {
      return { error: errorResponse("Request body is too large.", 413) };
    }

    const body: unknown = JSON.parse(rawBody);

    if (!isObject(body)) {
      return {
        error: errorResponse("Request body must be a JSON object.", 400),
      };
    }

    return { body };
  } catch {
    return {
      error: errorResponse("Invalid JSON request body.", 400),
    };
  }
}

function parseDueDate(
  value: unknown,
): { value: Date | null } | { error: string } {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }

  if (typeof value !== "string") {
    return { error: "Due date must be a valid YYYY-MM-DD string." };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return { error: "Due date must use YYYY-MM-DD format." };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { error: "Due date is not a valid calendar date." };
  }

  return { value: date };
}

async function verifyEventOwnership(eventId: string, userId: string) {
  return prisma.event.findFirst({
    where: { id: eventId, userId },
    select: { id: true },
  });
}

async function getValidatedEventId(
  params: RouteContext["params"],
): Promise<string | null> {
  const { id } = await params;

  if (!isValidId(id)) {
    return null;
  }

  return id.trim();
}

// GET /api/events/:id/checklist
export async function GET(
  _request: NextRequest,
  { params }: RouteContext,
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Unauthorized. Please login.", 401);
    }

    const id = await getValidatedEventId(params);

    if (!id) {
      return errorResponse("A valid event id is required.", 400);
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const items = await prisma.checklistItem.findMany({
      where: { eventId: id },
      orderBy: [
        { completed: "asc" },
        { dueDate: "asc" },
        { createdAt: "asc" },
      ],
    });

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      summary: {
        total: items.length,
        completed: items.filter((item) => item.completed).length,
        pending: items.filter((item) => !item.completed).length,
      },
    });
  } catch (error) {
    console.error("GET checklist error:", error);
    return errorResponse("Failed to fetch checklist.", 500);
  }
}

// POST /api/events/:id/checklist
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

    const id = await getValidatedEventId(params);

    if (!id) {
      return errorResponse("A valid event id is required.", 400);
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const parsed = await parseBody(request);
    if ("error" in parsed) return parsed.error;

    const body = parsed.body;

    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.trim().length > 200
    ) {
      return errorResponse(
        "Provide a valid checklist title (maximum 200 characters).",
        400,
      );
    }

    let category = "General";

    if (body.category !== undefined) {
      if (typeof body.category !== "string") {
        return errorResponse("Category must be a string.", 400);
      }

      category = body.category.trim() || "General";
    }

    if (category.length > 80) {
      return errorResponse("Category must be at most 80 characters.", 400);
    }

    const dueDateResult = parseDueDate(body.dueDate);

    if ("error" in dueDateResult) {
      return errorResponse(dueDateResult.error, 400);
    }

    const item = await prisma.checklistItem.create({
      data: {
        eventId: id,
        title: body.title.trim(),
        category,
        dueDate: dueDateResult.value,
      },
    });

    return NextResponse.json(
      { success: true, item },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST checklist error:", error);
    return errorResponse("Failed to add checklist item.", 500);
  }
}

// PATCH /api/events/:id/checklist
export async function PATCH(
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

    const id = await getValidatedEventId(params);

    if (!id) {
      return errorResponse("A valid event id is required.", 400);
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const parsed = await parseBody(request);
    if ("error" in parsed) return parsed.error;

    const body = parsed.body;

    if (!isValidId(body.itemId)) {
      return errorResponse("Provide a valid itemId.", 400);
    }

    const itemId = body.itemId.trim();

    const data: {
      completed?: boolean;
      title?: string;
      category?: string;
      dueDate?: Date | null;
    } = {};

    if ("completed" in body) {
      if (typeof body.completed !== "boolean") {
        return errorResponse("completed must be a boolean.", 400);
      }
      data.completed = body.completed;
    }

    if ("title" in body) {
      if (
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.trim().length > 200
      ) {
        return errorResponse("Provide a valid task title.", 400);
      }
      data.title = body.title.trim();
    }

    if ("category" in body) {
      if (
        typeof body.category !== "string" ||
        !body.category.trim() ||
        body.category.trim().length > 80
      ) {
        return errorResponse("Provide a valid category.", 400);
      }
      data.category = body.category.trim();
    }

    if ("dueDate" in body) {
      const result = parseDueDate(body.dueDate);

      if ("error" in result) {
        return errorResponse(result.error, 400);
      }

      data.dueDate = result.value;
    }

    if (Object.keys(data).length === 0) {
      return errorResponse("No fields to update.", 400);
    }

    const result = await prisma.checklistItem.updateMany({
      where: {
        id: itemId,
        eventId: id,
      },
      data,
    });

    if (result.count === 0) {
      return errorResponse("Checklist item not found.", 404);
    }

    const item = await prisma.checklistItem.findFirst({
      where: {
        id: itemId,
        eventId: id,
      },
    });

    if (!item) {
      return errorResponse("Checklist item not found.", 404);
    }

    return NextResponse.json({ success: true, item });
  } catch (error) {
    console.error("PATCH checklist error:", error);
    return errorResponse("Failed to update checklist item.", 500);
  }
}

// DELETE /api/events/:id/checklist?itemId=...
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

    const id = await getValidatedEventId(params);

    if (!id) {
      return errorResponse("A valid event id is required.", 400);
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return errorResponse("Event not found.", 404);
    }

    const itemId = request.nextUrl.searchParams.get("itemId")?.trim();

    if (!isValidId(itemId)) {
      return errorResponse("Provide a valid itemId.", 400);
    }

    const result = await prisma.checklistItem.deleteMany({
      where: {
        id: itemId,
        eventId: id,
      },
    });

    if (result.count === 0) {
      return errorResponse("Checklist item not found.", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Checklist item deleted.",
    });
  } catch (error) {
    console.error("DELETE checklist error:", error);
    return errorResponse("Failed to delete checklist item.", 500);
  }
}
