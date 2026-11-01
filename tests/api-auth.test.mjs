
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.API_URL
  ? new URL(process.env.API_URL).origin
  : "http://localhost:3000";

const ORIGIN = BASE_URL;
const AUTH_URL = `${BASE_URL}/api/auth`;

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

let cookie = "";
let testEmail = "";

async function api(path, options = {}) {
  return fetch(`${AUTH_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Origin: ORIGIN,
      ...options.headers,
    },
  });
}

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Set TEST_EMAIL and TEST_PASSWORD before running auth tests."
    );
  }

  const response = await api("/login", {
    method: "POST",
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
    }),
  });

  assert.equal(response.status, 200, "Test login failed.");

  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.length
    ? cookies
    : [response.headers.get("set-cookie") ?? ""];

  cookie = cookieHeader
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");

  assert.ok(cookie, "Login did not return a session cookie.");
}

test.before(async () => {
  await login();
  testEmail = `eventpilot-test-${randomUUID()}@example.com`;
});

test("SIGNUP rejects an invalid email", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: JSON.stringify({
      email: "invalid-email",
      password: "Password123",
    }),
  });

  assert.equal(response.status, 400);
});

test("SIGNUP rejects a password shorter than 8 characters", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: JSON.stringify({
      email: `short-${randomUUID()}@example.com`,
      password: "1234567",
    }),
  });

  assert.equal(response.status, 400);
});

test("SIGNUP rejects a password exceeding 72 UTF-8 bytes", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: JSON.stringify({
      email: `long-${randomUUID()}@example.com`,
      password: "a".repeat(73),
    }),
  });

  assert.equal(response.status, 400);
});

test("SIGNUP rejects missing credentials", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: JSON.stringify({
      email: testEmail,
    }),
  });

  assert.equal(response.status, 400);
});

test("SIGNUP rejects an array request body", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: JSON.stringify([]),
  });

  assert.equal(response.status, 400);
});

test("SIGNUP rejects invalid JSON", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: "{invalid-json",
  });

  assert.equal(response.status, 400);
});

test("SIGNUP rejects an oversized request body", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: JSON.stringify({
      email: testEmail,
      password: "Password123",
      extra: "x".repeat(9000),
    }),
  });

  assert.equal(response.status, 413);
});

test("SIGNUP creates a new account successfully", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: JSON.stringify({
      email: testEmail,
      password: "TestPassword123",
    }),
  });

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.user.email, testEmail);
  assert.ok(data.user.id);
  assert.ok(!data.user.passwordHash);
});

test("SIGNUP rejects a duplicate email", async () => {
  const response = await api("/signup", {
    method: "POST",
    body: JSON.stringify({
      email: testEmail,
      password: "TestPassword123",
    }),
  });

  assert.equal(response.status, 409);
});

test("ME returns the authenticated user", async () => {
  const response = await fetch(`${AUTH_URL}/me`, {
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.user.email, EMAIL);
});

test("LOGOUT successfully ends the session", async () => {
  const response = await fetch(`${AUTH_URL}/logout`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
    },
  });

  assert.ok(
    [200, 204].includes(response.status),
    `Unexpected logout status: ${response.status}`
  );

  cookie = "";
});
