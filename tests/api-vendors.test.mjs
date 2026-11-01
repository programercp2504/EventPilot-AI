
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
let vendorId = "";

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
      name: "Vendors API Test Event",
      type: "Birthday",
      date: "2027-12-15",
      guests: 50,
      budget: 100000,
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

function vendorPath(query = "") {
  return `/${eventId}/vendors${query}`;
}

async function createVendor() {
  const response = await api(vendorPath(), {
    method: "POST",
    body: JSON.stringify({
      name: "Test Catering Vendor",
      category: "Catering",
      contactName: "Test Contact",
      phone: "9876543210",
      email: "vendor@example.com",
      agreedCost: 25000,
      amountPaid: 5000,
      paymentDueDate: "2027-11-15",
      notes: "Automated API test vendor",
    }),
  });

  const responseText = await response.text();

  assert.equal(
    response.status,
    201,
    `Vendor creation failed. HTTP ${response.status}: ${responseText}`
  );

  const data = JSON.parse(responseText);

  assert.equal(data.success, true);
  assert.ok(data.vendor?.id, "Vendor ID missing.");

  vendorId = data.vendor.id;
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

test("GET returns an empty vendor list initially", async () => {
  const response = await api(vendorPath());

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.vendors));
  assert.equal(data.count, 0);
  assert.equal(data.summary.totalAgreed, 0);
  assert.equal(data.summary.totalPaid, 0);
  assert.equal(data.summary.totalDue, 0);
});

test("POST rejects an empty vendor name", async () => {
  const response = await api(vendorPath(), {
    method: "POST",
    body: JSON.stringify({
      name: "   ",
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects an invalid vendor name type", async () => {
  const response = await api(vendorPath(), {
    method: "POST",
    body: JSON.stringify({
      name: 123,
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects a negative agreed cost", async () => {
  const response = await api(vendorPath(), {
    method: "POST",
    body: JSON.stringify({
      name: "Invalid Vendor",
      agreedCost: -100,
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects payment greater than agreed cost", async () => {
  const response = await api(vendorPath(), {
    method: "POST",
    body: JSON.stringify({
      name: "Invalid Payment Vendor",
      agreedCost: 1000,
      amountPaid: 2000,
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects an invalid calendar payment due date", async () => {
  const response = await api(vendorPath(), {
    method: "POST",
    body: JSON.stringify({
      name: "Invalid Date Vendor",
      paymentDueDate: "2027-02-30",
    }),
  });

  assert.equal(response.status, 400);
});

test("POST rejects unknown fields", async () => {
  const response = await api(vendorPath(), {
    method: "POST",
    body: JSON.stringify({
      name: "Unknown Field Vendor",
      unexpectedField: "not allowed",
    }),
  });

  assert.equal(response.status, 400);
});

test("POST creates a vendor successfully", async () => {
  await createVendor();
});

test("GET returns the created vendor and correct payment summary", async () => {
  const response = await api(vendorPath());

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.count, 1);
  assert.ok(data.vendors.some((vendor) => vendor.id === vendorId));

  assert.equal(data.summary.totalAgreed, 25000);
  assert.equal(data.summary.totalPaid, 5000);
  assert.equal(data.summary.totalDue, 20000);
});

test("PATCH rejects an empty vendor update", async () => {
  const response = await api(
    vendorPath(`?id=${encodeURIComponent(vendorId)}`),
    {
      method: "PATCH",
      body: JSON.stringify({}),
    }
  );

  assert.equal(response.status, 400);
});

test("PATCH rejects payment greater than agreed cost", async () => {
  const response = await api(
    vendorPath(`?id=${encodeURIComponent(vendorId)}`),
    {
      method: "PATCH",
      body: JSON.stringify({
        amountPaid: 30000,
      }),
    }
  );

  assert.equal(response.status, 400);
});

test("PATCH rejects an invalid vendor ID", async () => {
  const response = await api(
    vendorPath("?id="),
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Vendor",
      }),
    }
  );

  assert.equal(response.status, 400);
});

test("PATCH updates vendor details successfully", async () => {
  const response = await api(
    vendorPath(`?id=${encodeURIComponent(vendorId)}`),
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Catering Vendor",
        amountPaid: 10000,
      }),
    }
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.vendor.name, "Updated Catering Vendor");
  assert.equal(data.vendor.amountPaid, 10000);
});

test("GET reflects the updated vendor payment summary", async () => {
  const response = await api(vendorPath());

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.summary.totalAgreed, 25000);
  assert.equal(data.summary.totalPaid, 10000);
  assert.equal(data.summary.totalDue, 15000);
});

test("PATCH returns 404 for a nonexistent vendor", async () => {
  const response = await api(
    vendorPath("?id=nonexistent-vendor-id"),
    {
      method: "PATCH",
      body: JSON.stringify({
        name: "Missing Vendor",
      }),
    }
  );

  assert.equal(response.status, 404);
});

test("DELETE removes the vendor successfully", async () => {
  const response = await api(
    vendorPath(`?id=${encodeURIComponent(vendorId)}`),
    {
      method: "DELETE",
    }
  );

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.success, true);
  assert.equal(data.id, vendorId);

  vendorId = "";
});

test("GET returns an empty vendor list after deletion", async () => {
  const response = await api(vendorPath());

  assert.equal(response.status, 200);

  const data = await response.json();

  assert.equal(data.count, 0);
  assert.equal(data.vendors.length, 0);
});

test("DELETE returns 404 for a nonexistent vendor", async () => {
  const response = await api(
    vendorPath("?id=nonexistent-vendor-id"),
    {
      method: "DELETE",
    }
  );

  assert.equal(response.status, 404);
});
