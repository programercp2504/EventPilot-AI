
import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { validateRequestOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const originError = validateRequestOrigin(request);

  if (originError) {
    return originError;
  }

  try {
    await destroySession();

    return NextResponse.json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to logout.",
      },
      { status: 500 }
    );
  }
}
