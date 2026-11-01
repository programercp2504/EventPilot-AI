
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

export async function POST(request: NextRequest) {
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

    if (!password) {
      return errorResponse("Password is required.", 400);
    }

    const passwordBytes = new TextEncoder().encode(password).length;

    if (passwordBytes > MAX_PASSWORD_BYTES) {
      return errorResponse(
        "Invalid email or password.",
        401
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        createdAt: true,
      },
    });

    if (
      !user ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return errorResponse(
        "Invalid email or password.",
        401
      );
    }

    await createSession(user.id);

    return NextResponse.json({
      success: true,
      message: "Login successful.",
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return errorResponse("Unable to login.", 500);
  }
}
