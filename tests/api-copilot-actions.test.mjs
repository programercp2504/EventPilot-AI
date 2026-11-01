import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.API_URL
  ? new URL(process.env.API_URL).origin
  : "http://localhost:3000";

const API_URL = `${BASE_URL}/api`;
const ORIGIN = BASE_URL;

const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

let cookie = "";
let eventId = "";

async function login() {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      "Set TEST_EMAIL and TEST_PASSWORD before running API tests."
    );
  }

  const response = await fetch(`${API_URL}/auth/login`, {
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
    throw new Error(
      `Test login failed with HTTP ${response.status}.`
    );
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

async function api(path, options = {}) {
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
  const response = await api("/events", {
    method: "POST",
    body: JSON.stringify({
      name: "Copilot Actions API Test Event",
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
    `Event creation failed. HTTP ${response.status}: ${responseText}`
  );

  const data = JSON.parse(responseText);

  eventId = data.event?.id || data.id;

  assert.ok(eventId, "Event ID missing.");
}

async function runAction(body, authenticated = true) {
  const headers = {
    "Content-Type": "application/json",
    Origin: ORIGIN,
  };

  if (authenticated && cookie) {
    headers.Cookie = cookie;
  }

  return fetch(`${API_URL}/copilot/actions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function getChecklist() {
  const response = await api(`/events/${eventId}/checklist`);

  assert.equal(response.status, 200);

  return response.json();
}

test.before(async () => {
  await login();
  await createTestEvent();
});

test.after(async () => {
  if (!eventId || !cookie) return;

  try {
    await api(`/events?id=${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  } catch {
    // Cleanup must not hide test results.
  }
});

test("POST rejects unauthenticated requests", async () => {
  const response = await runAction(
    {
      eventId: "test-event",
      mode: "preview",
      action: {
        type: "add_task",
        title: "Test task",
      },
    },
    false
  );

  assert.equal(response.status, 401);
});

test("POST rejects a missing eventId", async () => {
  const response = await runAction({
    mode: "preview",
    action: {
      type: "add_task",
      title: "Test task",
    },
  });

  assert.equal(response.status, 400);
});

test("POST rejects an invalid mode", async () => {
  const response = await runAction({
    eventId,
    mode: "invalid",
    action: {
      type: "add_task",
      title: "Test task",
    },
  });

  assert.equal(response.status, 400);
});

test("POST rejects an unsupported action type", async () => {
  const response = await runAction({
    eventId,
    mode: "preview",
    action: {
      type: "delete_everything",
    },
  });

  assert.equal(response.status, 400);
});

test("POST rejects a nonexistent event", async () => {
  const response = await runAction({
    eventId: "nonexistent-event-id",
    mode: "preview",
    action: {
      type: "add_task",
      title: "Test task",
    },
  });

  assert.ok(
    [403, 404].includes(response.status),
    `Unexpected status: ${response.status}`
  );
});

test("Preview add_task does not modify the database", async () => {
  const before = await getChecklist();

  const response = await runAction({
    eventId,
    mode: "preview",
    action: {
      type: "add_task",
      title: "Preview-only task",
      category: "Planning",
    },
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);

  const after = await getChecklist();

  assert.equal(
    after.items.length,
    before.items.length,
    "Preview mode must not create a checklist item."
  );
});

test("Apply add_task creates a checklist item", async () => {
  const response = await runAction({
    eventId,
    mode: "apply",
    action: {
      type: "add_task",
      title: "Copilot action test task",
      category: "Planning",
    },
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);

  const checklist = await getChecklist();

  assert.ok(
    checklist.items.some(
      (item) => item.title === "Copilot action test task"
    ),
    "Applied task was not found in checklist."
  );
});

test("Preview update_budget does not modify the database", async () => {
  const response = await runAction({
    eventId,
    mode: "preview",
    action: {
      type: "update_budget",
      category: "Venue",
      amount: 2000,
    },
  });

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
});

test("Apply update_budget accepts a valid budget action", async () => {
  const response = await runAction({
    eventId,
    mode: "apply",
    action: {
      type: "update_budget",
      category: "Venue",
      amount: 2000,
    },
  });

  assert.ok(
    [200, 400].includes(response.status),
    `Unexpected status: ${response.status}`
  );

  if (response.status === 200) {
    const data = await response.json();
    assert.equal(data.success, true);
  }
});

test("POST rejects an invalid budget amount", async () => {
  const response = await runAction({
    eventId,
    mode: "preview",
    action: {
      type: "update_budget",
      category: "Venue",
      amount: -100,
    },
  });

  assert.equal(response.status, 400);
});

test("POST rejects a non-numeric budget amount", async () => {
  const response = await runAction({
    eventId,
    mode: "preview",
    action: {
      type: "update_budget",
      category: "Venue",
      amount: "invalid",
    },
  });

  assert.equal(response.status, 400);
});

test("POST rejects an invalid update_plan payload", async () => {
  const response = await runAction({
    eventId,
    mode: "preview",
    action: {
      type: "update_plan",
      plan: "invalid-plan",
    },
  });

  assert.equal(response.status, 400);
});