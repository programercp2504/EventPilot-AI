
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { validateRequestOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_SIZE = 8 * 1024;
const MAX_PASSWORD_BYTES = 72;

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function POST(request: NextRequest) {
  // CSRF / Origin validation
  const originError = validateRequestOrigin(request);

  if (originError) {
    return originError;
  }

  try {
    const contentLength = Number(
      request.headers.get("content-length") || 0
    );

    if (contentLength > MAX_BODY_SIZE) {
      return errorResponse("Request body is too large.", 413);
    }

    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).length > MAX_BODY_SIZE) {
      return errorResponse("Request body is too large.", 413);
    }

    let body: unknown;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse("Invalid JSON request body.", 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return errorResponse("Invalid request body.", 400);
    }

    const data = body as Record<string, unknown>;

    if (
      typeof data.email !== "string" ||
      typeof data.password !== "string"
    ) {
      return errorResponse(
        "Email and password are required.",
        400
      );
    }

    const email = data.email.trim().toLowerCase();
    const password = data.password;

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return errorResponse("Enter a valid email address.", 400);
    }

    if (password.length < 8) {
      return errorResponse(
        "Password must contain at least 8 characters.",
        400
      );
    }

    const passwordBytes = new TextEncoder().encode(password).length;

    if (passwordBytes > MAX_PASSWORD_BYTES) {
      return errorResponse(
        "Password must not exceed 72 UTF-8 bytes.",
        400
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (existing) {
        throw new Error("EMAIL_ALREADY_EXISTS");
      }

      const isFirstUser = (await tx.user.count()) === 0;

      const newUser = await tx.user.create({
        data: {
          email,
          passwordHash,
        },
        select: {
          id: true,
          email: true,
          createdAt: true,
        },
      });

      if (isFirstUser) {
        await tx.event.updateMany({
          where: { userId: null },
          data: { userId: newUser.id },
        });
      }

      return newUser;
    });

    await createSession(user.id);

    return NextResponse.json(
      {
        success: true,
        message: "Account created successfully.",
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "EMAIL_ALREADY_EXISTS"
    ) {
      return errorResponse(
        "An account with this email already exists.",
        409
      );
    }

    if (isPrismaUniqueError(error)) {
      return errorResponse(
        "An account with this email already exists.",
        409
      );
    }

    console.error("Signup error:", error);

    return errorResponse("Unable to create account.", 500);
  }
}
