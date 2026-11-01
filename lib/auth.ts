
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "eventpilot_session";
const SESSION_DURATION = 7 * 24 * 60 * 60;

const JWT_ISSUER = "eventpilot-ai";
const JWT_AUDIENCE = "eventpilot-web";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;

  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error(
      "AUTH_SECRET must contain at least 32 bytes."
    );
  }

  return new TextEncoder().encode(secret);
}

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DURATION,
  };
}

export async function createSession(userId: string) {
  if (!userId || typeof userId !== "string") {
    throw new Error("Invalid user ID.");
  }

  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(getSecret());

  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, token, getCookieOptions());
}

export async function getSessionUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (!token || token.length > 4096) {
      return null;
    }

    const { payload, protectedHeader } = await jwtVerify(
      token,
      getSecret(),
      {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        maxTokenAge: `${SESSION_DURATION}s`,
        clockTolerance: 5,
      }
    );

    if (
      protectedHeader.typ !== "JWT" ||
      typeof payload.userId !== "string" ||
      payload.userId.length === 0 ||
      payload.userId !== payload.sub ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    if (
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > SESSION_DURATION
    ) {
      return null;
    }

    return payload.userId;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const userId = await getSessionUserId();

  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      createdAt: true,
    },
  });
}

export async function requireUser() {
  return getCurrentUser();
}

export async function destroySession() {
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, "", {
    ...getCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
}
