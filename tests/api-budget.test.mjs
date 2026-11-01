
import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.API_URL
  ? new URL(process.env.API_URL).origin
  : "http://localhost:3000";

const LOGIN_URL = `${BASE_URL}/api/auth/login`;
const EVENTS_URL = `${BASE_URL}/api/events`;

let sessionCookie = "";
let eventId = "";

const testEvent = {
  name: `Budget API Test ${Date.now()}`,
  type: "Community",
  date: "2027-12-15",
  guests: 20,
  budget: 10000,
};

async function login() {
  const email = process.env.TEST_EMAIL;
  const password = process.env.TEST_PASSWORD;

  if (!email || !password) {
    throw new Error("Set TEST_EMAIL and TEST_PASSWORD first.");
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
    throw new Error(`Login failed: HTTP ${response.status}`);
  }

  const cookies = response.headers.getSetCookie?.() ?? [];

  sessionCookie = cookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");

  if (!sessionCookie) {
    throw new Error("Login did not return a session cookie.");
  }
}

async function apiRequest(url, method, body) {
  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Cookie: sessionCookie,
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
  });
}

async function createTestEvent() {
  const response = await apiRequest(
    EVENTS_URL,
    "POST",
    testEvent
  );

  assert.equal(response.status, 201);

  const result = await response.json();

  assert.equal(result.success, true);
  eventId = result.event.id;

  assert.ok(eventId);
}

async function deleteTestEvent() {
  if (!eventId) return;

  await apiRequest(
    `${EVENTS_URL}?id=${encodeURIComponent(eventId)}`,
    "DELETE"
  );

  eventId = "";
}

test.before(async () => {
  await login();
  await createTestEvent();
});

test.after(async () => {
  await deleteTestEvent();
});

const budgetUrl = (query = "") =>
  `${BASE_URL}/api/events/${encodeURIComponent(eventId)}/budget${query}`;

test("returns an empty budget initially", async () => {
  const response = await apiRequest(
    budgetUrl(),
    "GET"
  );

  assert.equal(response.status, 200);

  const result = await response.json();

  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.items));
  assert.equal(result.totalAllocated, 0);
  assert.equal(result.remaining, testEvent.budget);
});

test("rejects a negative budget allocation", async () => {
  const response = await apiRequest(
    budgetUrl(),
    "POST",
    {
      category: "Venue",
      amount: -100,
    }
  );

  assert.equal(response.status, 400);
});

test("rejects an invalid category", async () => {
  const response = await apiRequest(
    budgetUrl(),
    "POST",
    {
      category: "",
      amount: 1000,
    }
  );

  assert.equal(response.status, 400);
});

test("rejects allocation exceeding the event budget", async () => {
  const response = await apiRequest(
    budgetUrl(),
    "POST",
    {
      category: "Venue",
      amount: 11000,
    }
  );

  assert.equal(response.status, 400);
});

test("creates and updates a budget category", async () => {
  const createResponse = await apiRequest(
    budgetUrl(),
    "POST",
    {
      category: "Venue",
      amount: 3000,
    }
  );

  assert.equal(createResponse.status, 200);

  const created = await createResponse.json();

  assert.equal(created.success, true);
  assert.equal(created.item.category, "Venue");
  assert.equal(created.item.amount, 3000);
  assert.equal(created.totalAllocated, 3000);
  assert.equal(created.remaining, 7000);

  const updateResponse = await apiRequest(
    budgetUrl(),
    "POST",
    {
      category: "Venue",
      amount: 4000,
    }
  );

  assert.equal(updateResponse.status, 200);

  const updated = await updateResponse.json();

  assert.equal(updated.item.amount, 4000);
  assert.equal(updated.totalAllocated, 4000);
  assert.equal(updated.remaining, 6000);
});

test("lists saved budget categories", async () => {
  const response = await apiRequest(
    budgetUrl(),
    "GET"
  );

  assert.equal(response.status, 200);

  const result = await response.json();

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].category, "Venue");
  assert.equal(result.totalAllocated, 4000);
  assert.equal(result.remaining, 6000);
});

test("deletes a budget category", async () => {
  const response = await apiRequest(
    budgetUrl("?category=Venue"),
    "DELETE"
  );

  assert.equal(response.status, 200);

  const result = await response.json();

  assert.equal(result.success, true);

  const getResponse = await apiRequest(
    budgetUrl(),
    "GET"
  );

  const remaining = await getResponse.json();

  assert.equal(remaining.items.length, 0);
  assert.equal(remaining.totalAllocated, 0);
  assert.equal(remaining.remaining, 10000);
});

test("returns 404 for a nonexistent budget category", async () => {
  const response = await apiRequest(
    budgetUrl("?category=Nonexistent"),
    "DELETE"
  );

  assert.equal(response.status, 404);
});
