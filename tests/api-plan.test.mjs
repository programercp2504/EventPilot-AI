
import test from "node:test";
import assert from "node:assert/strict";

const API_URL =
  process.env.API_URL ?? "http://localhost:3000/api/plan";

const BASE_URL = new URL(API_URL).origin;
const LOGIN_URL = `${BASE_URL}/api/auth/login`;

let sessionCookie = "";

async function login() {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set TEST_EMAIL and TEST_PASSWORD before running API tests."
    );
  }

  const response = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(
      `Test login failed with HTTP ${response.status}.`
    );
  }

  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.length
    ? cookies
    : [response.headers.get("set-cookie") ?? ""];

  sessionCookie = cookieHeader
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");

  if (!sessionCookie) {
    throw new Error("Login did not return a session cookie.");
  }
}

async function postPlan(payload) {
  return fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Cookie: sessionCookie,
    },
    body: JSON.stringify(payload),
  });
}

const validEvent = {
  name: "Community Meetup",
  type: "Community",
  date: "2027-12-15",
  guests: 50,
  budget: 25000,
};

test.before(async () => {
  await login();
});

test("rejects an impossible calendar date", async () => {
  const response = await postPlan({
    ...validEvent,
    date: "2026-02-31",
  });

  assert.equal(response.status, 400);
});

test("rejects zero guests", async () => {
  const response = await postPlan({
    ...validEvent,
    guests: 0,
  });

  assert.equal(response.status, 400);
});

test("rejects a negative budget", async () => {
  const response = await postPlan({
    ...validEvent,
    budget: -100,
  });

  assert.equal(response.status, 400);
});

test("generates a plan within the requested budget", async () => {
  const response = await postPlan(validEvent);

  assert.equal(response.status, 200);

  const result = await response.json();

  assert.equal(result.success, true);
  assert.ok(result.plan);
  assert.ok(Array.isArray(result.plan.budgetBreakdown));
  assert.ok(result.plan.budgetBreakdown.length > 0);

  const total = result.plan.budgetBreakdown.reduce(
    (sum, item) => sum + item.amount,
    0,
  );

  assert.equal(total, validEvent.budget);
});
