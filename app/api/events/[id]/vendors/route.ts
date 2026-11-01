
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { validateRequestOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 10 * 1024;
const MAX_ID_LENGTH = 200;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type VendorInput = {
  name?: unknown;
  category?: unknown;
  contactName?: unknown;
  phone?: unknown;
  email?: unknown;
  agreedCost?: unknown;
  amountPaid?: unknown;
  paymentDueDate?: unknown;
  notes?: unknown;
};

const ALLOWED_FIELDS = new Set([
  "name",
  "category",
  "contactName",
  "phone",
  "email",
  "agreedCost",
  "amountPaid",
  "paymentDueDate",
  "notes",
]);

function responseError(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_ID_LENGTH
  );
}

async function parseBody(request: NextRequest): Promise<
  | { body: VendorInput }
  | { error: NextResponse }
> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    const parsedLength = Number(contentLength);

    if (
      !Number.isFinite(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_BODY_SIZE
    ) {
      return {
        error: responseError("Request body is too large or invalid.", 413),
      };
    }
  }

  try {
    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_SIZE) {
      return {
        error: responseError("Request body is too large.", 413),
      };
    }

    if (!rawBody.trim()) {
      return {
        error: responseError("Request body is required.", 400),
      };
    }

    const body: unknown = JSON.parse(rawBody);

    if (!isObject(body)) {
      return {
        error: responseError("Request body must be a JSON object.", 400),
      };
    }

    const unknownFields = Object.keys(body).filter(
      (key) => !ALLOWED_FIELDS.has(key)
    );

    if (unknownFields.length > 0) {
      return {
        error: responseError(
          `Unknown field: ${unknownFields[0]}.`,
          400
        ),
      };
    }

    return { body: body as VendorInput };
  } catch {
    return {
      error: responseError("Invalid JSON request body.", 400),
    };
  }
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number
): { value?: string | null; error?: string } {
  if (value === undefined) return {};

  if (value === null || value === "") {
    return { value: null };
  }

  if (typeof value !== "string") {
    return { error: `${field} must be a string.` };
  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {
    return {
      error: `${field} must be at most ${maxLength} characters.`,
    };
  }

  return { value: normalized || null };
}

function parseDate(
  value: unknown
): { value: Date | null } | { error: string } {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }

  if (typeof value !== "string") {
    return {
      error: "Payment due date must be a valid date string.",
    };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return {
      error: "Payment due date must use YYYY-MM-DD format.",
    };
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
    return {
      error: "Payment due date is not a valid calendar date.",
    };
  }

  return { value: date };
}

function parseMoney(
  value: unknown,
  field: string
): { value: number } | { error: string } {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 100000000
  ) {
    return {
      error: `${field} must be a whole number between 0 and 100000000 INR.`,
    };
  }

  return { value };
}

function startOfTodayUTC() {
  const now = new Date();

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );
}

function getPaymentStatus(
  agreedCost: number,
  amountPaid: number,
  paymentDueDate: Date | null
) {
  const balanceDue = agreedCost - amountPaid;

  if (balanceDue === 0) return "paid";

  if (
    paymentDueDate &&
    paymentDueDate.getTime() < startOfTodayUTC().getTime()
  ) {
    return "overdue";
  }

  if (amountPaid > 0) return "partially_paid";

  return "unpaid";
}

function serializeVendor<
  T extends {
    agreedCost: number;
    amountPaid: number;
    paymentDueDate: Date | null;
  }
>(vendor: T) {
  return {
    ...vendor,
    balanceDue: vendor.agreedCost - vendor.amountPaid,
    paymentStatus: getPaymentStatus(
      vendor.agreedCost,
      vendor.amountPaid,
      vendor.paymentDueDate
    ),
  };
}

function validateVendor(body: VendorInput, partial: boolean) {
  const data: Record<string, unknown> = {};

  if (!partial || body.name !== undefined) {
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 120
    ) {
      return {
        error: "Vendor name is required (maximum 120 characters).",
      };
    }

    data.name = body.name.trim();
  }

  if (body.category !== undefined || !partial) {
    const category =
      body.category === undefined ? "Other" : body.category;

    if (
      typeof category !== "string" ||
      !category.trim() ||
      category.trim().length > 80
    ) {
      return { error: "Category must be 1–80 characters." };
    }

    data.category = category.trim();
  }

  const textFields = [
    ["contactName", "Contact name", 120],
    ["phone", "Phone", 40],
    ["email", "Email", 254],
    ["notes", "Notes", 2000],
  ] as const;

  for (const [key, label, maxLength] of textFields) {
    const result = optionalText(body[key], label, maxLength);

    if (result.error) return { error: result.error };

    if (result.value !== undefined) {
      data[key] = result.value;
    }
  }

  if (data.email && typeof data.email === "string") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return { error: "Please provide a valid email address." };
    }
  }

  if (body.agreedCost !== undefined || !partial) {
    const result = parseMoney(
      body.agreedCost === undefined ? 0 : body.agreedCost,
      "Agreed cost"
    );

    if ("error" in result) return result;

    data.agreedCost = result.value;
  }

  if (body.amountPaid !== undefined || !partial) {
    const result = parseMoney(
      body.amountPaid === undefined ? 0 : body.amountPaid,
      "Amount paid"
    );

    if ("error" in result) return result;

    data.amountPaid = result.value;
  }

  if (body.paymentDueDate !== undefined || !partial) {
    const result = parseDate(body.paymentDueDate);

    if ("error" in result) return result;

    data.paymentDueDate = result.value;
  }

  if (partial && Object.keys(data).length === 0) {
    return { error: "At least one valid field is required." };
  }

  return { data };
}

function validatePaymentAmounts(
  agreedCost: number,
  amountPaid: number
) {
  if (amountPaid > agreedCost) {
    return "Amount paid cannot exceed the agreed cost.";
  }

  return null;
}

async function verifyEventOwnership(
  eventId: string,
  userId: string
) {
  return prisma.event.findFirst({
    where: {
      id: eventId,
      userId,
    },
    select: {
      id: true,
      name: true,
    },
  });
}

// GET /api/events/:id/vendors
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return responseError("Unauthorized. Please login.", 401);
    }

    const { id } = await params;

    if (!isValidId(id)) {
      return responseError("Invalid event id.", 400);
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return responseError("Event not found.", 404);
    }

    const vendorRecords = await prisma.vendor.findMany({
      where: { eventId: id },
      orderBy: { createdAt: "desc" },
    });

    const vendors = vendorRecords.map(serializeVendor);

    const summary = vendors.reduce(
      (result, vendor) => {
        result.totalAgreed += vendor.agreedCost;
        result.totalPaid += vendor.amountPaid;
        result.totalDue += vendor.balanceDue;

        if (vendor.paymentStatus === "overdue") {
          result.overdueCount += 1;
          result.overdueAmount += vendor.balanceDue;
        }

        return result;
      },
      {
        totalAgreed: 0,
        totalPaid: 0,
        totalDue: 0,
        overdueCount: 0,
        overdueAmount: 0,
      }
    );

    return NextResponse.json({
      success: true,
      event: {
        id: event.id,
        name: event.name,
      },
      vendors,
      count: vendors.length,
      summary,
    });
  } catch (error) {
    console.error("GET vendors error:", error);

    return responseError("Failed to fetch vendors.", 500);
  }
}

// POST /api/events/:id/vendors
export async function POST(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const originError = validateRequestOrigin(request);

    if (originError) return originError;

    const user = await getCurrentUser();

    if (!user) {
      return responseError("Unauthorized. Please login.", 401);
    }

    const { id } = await params;

    if (!isValidId(id)) {
      return responseError("Invalid event id.", 400);
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return responseError("Event not found.", 404);
    }

    const parsed = await parseBody(request);

    if ("error" in parsed) return parsed.error;

    const validated = validateVendor(parsed.body, false);

    if ("error" in validated) {
  return responseError(
    validated.error ?? "Invalid vendor data.",
    400
  );
}

    const data = validated.data as {
      name: string;
      category: string;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      agreedCost: number;
      amountPaid: number;
      paymentDueDate: Date | null;
      notes?: string | null;
    };

    const paymentError = validatePaymentAmounts(
      data.agreedCost,
      data.amountPaid
    );

    if (paymentError) {
      return responseError(paymentError, 400);
    }

    const vendor = await prisma.vendor.create({
      data: {
        ...data,
        eventId: id,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Vendor added successfully.",
        vendor: serializeVendor(vendor),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST vendor error:", error);

    return responseError("Failed to add vendor.", 500);
  }
}

// PATCH /api/events/:id/vendors?id=VENDOR_ID
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const originError = validateRequestOrigin(request);

    if (originError) return originError;

    const user = await getCurrentUser();

    if (!user) {
      return responseError("Unauthorized. Please login.", 401);
    }

    const { id } = await params;

    if (!isValidId(id)) {
      return responseError("Invalid event id.", 400);
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return responseError("Event not found.", 404);
    }

    const vendorId = request.nextUrl.searchParams.get("id")?.trim();

    if (!isValidId(vendorId)) {
      return responseError("Vendor id is required in the URL.", 400);
    }

    const parsed = await parseBody(request);

    if ("error" in parsed) return parsed.error;

    const validated = validateVendor(parsed.body, true);

    if ("error" in validated) {
  return responseError(
    validated.error ?? "Invalid vendor data.",
    400
  );
}

    const data = validated.data as Record<string, unknown>;

    const vendor = await prisma.$transaction(async (tx) => {
      const existing = await tx.vendor.findFirst({
        where: {
          id: vendorId,
          eventId: id,
        },
      });

      if (!existing) {
        throw new Error("VENDOR_NOT_FOUND");
      }

      const agreedCost =
        (data.agreedCost as number | undefined) ??
        existing.agreedCost;

      const amountPaid =
        (data.amountPaid as number | undefined) ??
        existing.amountPaid;

      if (amountPaid > agreedCost) {
        throw new Error("INVALID_PAYMENT_AMOUNT");
      }

      const result = await tx.vendor.updateMany({
        where: {
          id: vendorId,
          eventId: id,
        },
        data,
      });

      if (result.count === 0) {
        throw new Error("VENDOR_NOT_FOUND");
      }

      return tx.vendor.findFirst({
        where: {
          id: vendorId,
          eventId: id,
        },
      });
    });

    if (!vendor) {
      return responseError("Vendor not found.", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Vendor updated successfully.",
      vendor: serializeVendor(vendor),
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "VENDOR_NOT_FOUND") {
        return responseError("Vendor not found.", 404);
      }

      if (error.message === "INVALID_PAYMENT_AMOUNT") {
        return responseError(
          "Amount paid cannot exceed the agreed cost.",
          400
        );
      }
    }

    console.error("PATCH vendor error:", error);

    return responseError("Failed to update vendor.", 500);
  }
}

// DELETE /api/events/:id/vendors?id=VENDOR_ID
export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const originError = validateRequestOrigin(request);

    if (originError) return originError;

    const user = await getCurrentUser();

    if (!user) {
      return responseError("Unauthorized. Please login.", 401);
    }

    const { id } = await params;

    if (!isValidId(id)) {
      return responseError("Invalid event id.", 400);
    }

    const event = await verifyEventOwnership(id, user.id);

    if (!event) {
      return responseError("Event not found.", 404);
    }

    const vendorId = request.nextUrl.searchParams.get("id")?.trim();

    if (!isValidId(vendorId)) {
      return responseError("Vendor id is required in the URL.", 400);
    }

    const result = await prisma.vendor.deleteMany({
      where: {
        id: vendorId,
        eventId: id,
      },
    });

    if (result.count === 0) {
      return responseError("Vendor not found.", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Vendor deleted successfully.",
      id: vendorId,
    });
  } catch (error) {
    console.error("DELETE vendor error:", error);

    return responseError("Failed to delete vendor.", 500);
  }
}
