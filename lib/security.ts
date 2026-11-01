
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const STATE_CHANGING_METHODS = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export function validateRequestOrigin(
  request: NextRequest
): NextResponse | null {
  if (!STATE_CHANGING_METHODS.has(request.method)) {
    return null;
  }

  const origin = request.headers.get("origin");

  // Reject missing Origin on browser-facing state-changing requests.
  if (!origin) {
    return NextResponse.json(
      {
        success: false,
        error: "Request origin is required.",
      },
      { status: 403 }
    );
  }

  try {
    const parsedOrigin = new URL(origin).origin;

    if (!ALLOWED_ORIGINS.has(parsedOrigin)) {
      return NextResponse.json(
        {
          success: false,
          error: "Request origin is not allowed.",
        },
        { status: 403 }
      );
    }

    const requestOrigin = new URL(request.url).origin;

    if (parsedOrigin !== requestOrigin) {
      return NextResponse.json(
        {
          success: false,
          error: "Cross-origin request rejected.",
        },
        { status: 403 }
      );
    }

    return null;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid request origin.",
      },
      { status: 403 }
    );
  }
}
