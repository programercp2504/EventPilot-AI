
import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL =
  process.env.API_URL
    ? new URL(process.env.API_URL).origin
    : "http://localhost:3000";

const API_URL = `${BASE_URL}/api/events`;
const LOGIN_URL = `${BASE_URL}/api/auth/login`;

let sessionCookie = "";
let createdEventId = "";

const testEvent = {
  name: `API Test Event ${Date.now()}`,
  type: "Community",
  date: "2027-12-15",
  guests: 50,
  budget: 25000,
};

async function login() {
  const { TEST_EMAIL, TEST_PASSWORD } = process.env;

  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error("Set TEST_EMAIL and TEST_PASSWORD first.");
  }

  const response = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }),
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

async function requestEvents(method, body, query = "") {
  return fetch(`${API_URL}${query}`, {
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

test.before(async () => {
  await login();
});

test("rejects an impossible event date", async () => {
  const response = await requestEvents("POST", {
    ...testEvent,
    date: "2026-02-31",
  });

  assert.equal(response.status, 400);
});

test("rejects zero guests", async () => {
  const response = await requestEvents("POST", {
    ...testEvent,
    guests: 0,
  });

  assert.equal(response.status, 400);
});

test("rejects a negative budget", async () => {
  const response = await requestEvents("POST", {
    ...testEvent,
    budget: -100,
  });

  assert.equal(response.status, 400);
});

test("rejects an invalid event name", async () => {
  const response = await requestEvents("POST", {
    ...testEvent,
    name: "",
  });

  assert.equal(response.status, 400);
});

test("supports event creation, listing, updating and deletion", async () => {
  // CREATE
  const createResponse = await requestEvents(
    "POST",
    testEvent
  );

  assert.equal(createResponse.status, 201);

  const created = await createResponse.json();

  assert.equal(created.success, true);
  assert.ok(created.event);
  assert.equal(created.event.name, testEvent.name);

  createdEventId = created.event.id;
  assert.ok(createdEventId);

  try {
    // READ
    const listResponse = await requestEvents("GET");

    assert.equal(listResponse.status, 200);

    const listResult = await listResponse.json();

    assert.equal(listResult.success, true);
    assert.ok(Array.isArray(listResult.events));

    assert.ok(
      listResult.events.some(
        (event) => event.id === createdEventId
      )
    );

    // UPDATE
    const updatedData = {
      ...testEvent,
      name: `${testEvent.name} Updated`,
      guests: 75,
      budget: 30000,
    };

    const updateResponse = await requestEvents(
      "PUT",
      {
        id: createdEventId,
        ...updatedData,
      }
    );

    assert.equal(updateResponse.status, 200);

    const updated = await updateResponse.json();

    assert.equal(updated.success, true);
    assert.equal(updated.event.name, updatedData.name);
    assert.equal(updated.event.guests, 75);
    assert.equal(updated.event.budget, 30000);

    // DELETE
    const deleteResponse = await requestEvents(
      "DELETE",
      undefined,
      `?id=${encodeURIComponent(createdEventId)}`
    );

    assert.equal(deleteResponse.status, 200);

    const deleted = await deleteResponse.json();

    assert.equal(deleted.success, true);
    assert.equal(deleted.id, createdEventId);

    createdEventId = "";
  } finally {
    // Cleanup only the event created by this test.
    if (createdEventId) {
      await requestEvents(
        "DELETE",
        undefined,
        `?id=${encodeURIComponent(createdEventId)}`
      );
    }
  }
});

test("rejects updating a nonexistent event", async () => {
  const response = await requestEvents("PUT", {
    id: "nonexistent-test-event-id",
    ...testEvent,
  });

  assert.equal(response.status, 404);
});

test("rejects deleting a nonexistent event", async () => {
  const response = await requestEvents(
    "DELETE",
    undefined,
    "?id=nonexistent-test-event-id"
  );

  assert.equal(response.status, 404);
});
