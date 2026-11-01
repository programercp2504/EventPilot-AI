import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.API_URL
  ? new URL(process.env.API_URL).origin
  : "http://localhost:3000";

const API_URL = `${BASE_URL}/api/events`;
const ORIGIN = BASE_URL;

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

let cookie = "";
let eventId = "";
let checklistItemId = "";

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Set TEST_EMAIL and TEST_PASSWORD before running API tests."
    );
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
    }),
  });

  if (!response.ok) {
    throw new Error(`Test login failed with HTTP ${response.status}.`);
  }

  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookieHeader = cookies.length
    ? cookies
    : [response.headers.get("set-cookie") ?? ""];

  cookie = cookieHeader
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");

  if (!cookie) {
    throw new Error("Login did not return a session cookie.");
  }
}

async function api(path = "", options = {}) {
  const headers = {
    Origin: ORIGIN,
    Cookie: cookie,
    ...(options.body
      ? { "Content-Type": "application/json" }
      : {}),
    ...options.headers,
  };

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
}

async function createTestEvent() {
  const response = await api("", {
    method: "POST",
    body: JSON.stringify({
      name: "Checklist API Test Event",
      type: "Birthday",
      date: "2027-12-15",
      guests: 50,
      budget: 10000,
    }),
  });

  const responseText = await response.text();

  assert.equal(
    response.status,
    201,
    `Test event creation failed. HTTP ${response.status}: ${responseText}`
  );

  const data = JSON.parse(responseText);

  assert.ok(data.event?.id || data.id, "Event ID missing.");

  eventId = data.event?.id || data.id;
}

test.before(async () => {
  await login();
  await createTestEvent();
});

test.after(async () => {
  if (!eventId || !cookie) return;

  try {
    await api(`?id=${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  } catch {
    // Cleanup must not hide test results.
  }
});

test("GET checklist returns an empty checklist initially", async () => {
  const response = await api(`/${eventId}/checklist`);

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.items));
  assert.equal(data.summary.total, 0);
});

test("POST rejects an empty checklist title", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "POST",
    body: JSON.stringify({ title: "   " }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects a checklist title longer than 200 characters", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "POST",
    body: JSON.stringify({ title: "A".repeat(201) }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects an invalid calendar due date", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "POST",
    body: JSON.stringify({
      title: "Invalid date task",
      dueDate: "2027-02-30",
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects an invalid category type", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "POST",
    body: JSON.stringify({
      title: "Test task",
      category: 123,
    }),
  });

  assert.equal(response.status, 400);
});

test("POST creates a checklist item successfully", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "POST",
    body: JSON.stringify({
      title: "Book the venue",
      category: "Venue",
      dueDate: "2027-11-15",
    }),
  });

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.item.title, "Book the venue");
  assert.equal(data.item.category, "Venue");

  checklistItemId = data.item.id;
  assert.ok(checklistItemId);
});

test("GET returns the created checklist item", async () => {
  const response = await api(`/${eventId}/checklist`);

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.ok(data.items.some((item) => item.id === checklistItemId));
  assert.equal(data.summary.total, 1);
  assert.equal(data.summary.pending, 1);
});

test("PATCH updates checklist completion status", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "PATCH",
    body: JSON.stringify({
      itemId: checklistItemId,
      completed: true,
    }),
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.item.completed, true);
});

test("PATCH rejects a non-boolean completed value", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "PATCH",
    body: JSON.stringify({
      itemId: checklistItemId,
      completed: "yes",
    }),
  });

  assert.equal(response.status, 400);
});

test("PATCH rejects an empty update", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "PATCH",
    body: JSON.stringify({
      itemId: checklistItemId,
    }),
  });

  assert.equal(response.status, 400);
});

test("PATCH updates checklist title and category", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "PATCH",
    body: JSON.stringify({
      itemId: checklistItemId,
      title: "Confirm the venue booking",
      category: "Planning",
    }),
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.item.title, "Confirm the venue booking");
  assert.equal(data.item.category, "Planning");
});

test("PATCH returns 404 for a nonexistent checklist item", async () => {
  const response = await api(`/${eventId}/checklist`, {
    method: "PATCH",
    body: JSON.stringify({
      itemId: "nonexistent-checklist-item",
      completed: true,
    }),
  });

  assert.equal(response.status, 404);
});

test("DELETE removes the checklist item", async () => {
  const response = await api(
    `/${eventId}/checklist?itemId=${encodeURIComponent(checklistItemId)}`,
    { method: "DELETE" }
  );

  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.success, true);

  checklistItemId = "";
});

test("DELETE returns 404 for a nonexistent checklist item", async () => {
  const response = await api(
    `/${eventId}/checklist?itemId=nonexistent-checklist-item`,
    { method: "DELETE" }
  );

  assert.equal(response.status, 404);
});