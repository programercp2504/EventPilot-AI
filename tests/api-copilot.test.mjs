
import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.API_URL
  ? new URL(process.env.API_URL).origin
  : "http://localhost:3000";

const API_URL = `${BASE_URL}/api/events`;
const COPILOT_URL = `${BASE_URL}/api/copilot`;
const ORIGIN = BASE_URL;

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

let cookie = "";
let eventId = "";

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error("Set TEST_EMAIL and TEST_PASSWORD first.");
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  assert.equal(response.status, 200);

  const cookies = response.headers.getSetCookie?.() ?? [];
  const values = cookies.length
    ? cookies
    : [response.headers.get("set-cookie") ?? ""];

  cookie = values
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");

  assert.ok(cookie);
}

async function eventApi(path = "", options = {}) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function copilotApi(path = "", options = {}) {
  return fetch(`${COPILOT_URL}${path}`, {
    ...options,
    headers: {
      Origin: ORIGIN,
      Cookie: cookie,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function createEvent() {
  const response = await eventApi("", {
    method: "POST",
    body: JSON.stringify({
      name: "Copilot API Test Event",
      type: "Birthday",
      date: "2027-12-15",
      guests: 50,
      budget: 100000,
    }),
  });

  const text = await response.text();

  assert.equal(
    response.status,
    201,
    `Event creation failed: ${text}`
  );

  const data = JSON.parse(text);
  eventId = data.event?.id || data.id;

  assert.ok(eventId);
}

test.before(async () => {
  await login();
  await createEvent();
});

test.after(async () => {
  if (!eventId || !cookie) return;

  try {
    await eventApi(`?id=${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  } catch {
    // Keep cleanup errors separate from test results.
  }
});

test("GET rejects missing eventId", async () => {
  const response = await copilotApi("");

  assert.equal(response.status, 400);
});

test("GET returns 404 for nonexistent event", async () => {
  const response = await copilotApi("?eventId=nonexistent-event-id");

  assert.equal(response.status, 404);
});

test("GET returns empty chat history initially", async () => {
  const response = await copilotApi(
    `?eventId=${encodeURIComponent(eventId)}`
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.messages));
  assert.equal(data.messages.length, 0);
});

test("POST rejects invalid JSON", async () => {
  const response = await copilotApi("", {
    method: "POST",
    body: "{invalid-json",
  });

  assert.equal(response.status, 400);
});

test("POST rejects missing eventId", async () => {
  const response = await copilotApi("", {
    method: "POST",
    body: JSON.stringify({
      message: "Help me plan my event",
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects empty message", async () => {
  const response = await copilotApi("", {
    method: "POST",
    body: JSON.stringify({
      eventId,
      message: "   ",
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects message longer than 2000 characters", async () => {
  const response = await copilotApi("", {
    method: "POST",
    body: JSON.stringify({
      eventId,
      message: "A".repeat(2001),
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects nonexistent event", async () => {
  const response = await copilotApi("", {
    method: "POST",
    body: JSON.stringify({
      eventId: "nonexistent-event-id",
      message: "Help me plan my event",
    }),
  });

  assert.equal(response.status, 404);
});

test("DELETE rejects missing eventId", async () => {
  const response = await copilotApi("", {
    method: "DELETE",
  });

  assert.equal(response.status, 400);
});

test("DELETE returns 404 for nonexistent event", async () => {
  const response = await copilotApi(
    "?eventId=nonexistent-event-id",
    { method: "DELETE" }
  );

  assert.equal(response.status, 404);
});

test("DELETE clears chat history successfully", async () => {
  const response = await copilotApi(
    `?eventId=${encodeURIComponent(eventId)}`,
    { method: "DELETE" }
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
});
