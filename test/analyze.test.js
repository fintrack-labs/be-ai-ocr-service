import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

const config = {
  maxImageBytes: 1024 * 1024,
  corsAllowedOrigins: ["http://localhost:5173"],
  beAppBaseUrl: "https://finance.example.test/api/",
  aiApiBaseUrl: "https://ai.example.test/v1/",
  aiApiKey: "test-ai-secret",
  aiModel: "test-vision-model",
  requestTimeoutMs: 1000,
  masterDataPageSize: 10,
};

const account = {
  id: 12,
  name: "Everyday Account",
  type: "BANK",
  balance: 999999,
  accountNumber: "1234567890",
  currency: "IDR",
};

const category = {
  id: 44,
  name: "Food",
  type: "EXPENSE",
  parentId: null,
  children: [{ id: 45, name: "Restaurants", type: "EXPENSE", parentId: "44", children: [] }],
};

function paginated(data, page = 1, pageCount = 1) {
  return new Response(JSON.stringify({ data, page, limit: 10, totalItems: data.length, pageCount }), {
    headers: { "Content-Type": "application/json" },
  });
}

function multipartImage() {
  const boundary = "test-boundary";
  const body = [
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="receipt.png"\r\nContent-Type: image/png\r\n\r\nimage-bytes\r\n`,
    `--${boundary}--\r\n`,
  ].join("");
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  };
}

function multipartImageWithHints() {
  const boundary = "hints-boundary";
  const body = [
    `--${boundary}\r\nContent-Disposition: form-data; name="documentType"\r\n\r\nreceipt\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="locale"\r\n\r\nid-ID\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="receipt.png"\r\nContent-Type: image/png\r\n\r\nimage-bytes\r\n`,
    `--${boundary}--\r\n`,
  ].join("");
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  };
}

function aiResponse(analysis) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(analysis) } }],
  }), { headers: { "Content-Type": "application/json" } });
}

function validAnalysis(overrides = {}) {
  return {
    detectedLanguage: "id",
    transactionDate: "2026-09-30",
    merchantName: "Warung Contoh",
    amount: 25000,
    currency: "IDR",
    accountId: 12,
    categoryId: 45,
    confidence: 0.9,
    rawText: "Warung Contoh 25.000",
    ...overrides,
  };
}

function mockFetch({ analysis = validAnalysis(), onAiRequest = () => {} } = {}) {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.hostname === "finance.example.test") {
      assert.equal(options.headers.Authorization, "Bearer user-token");
      return paginated(url.pathname.endsWith("/accounts") ? [account] : [category]);
    }
    if (url.hostname === "ai.example.test") {
      onAiRequest(options);
      return aiResponse(analysis);
    }
    throw new Error("Unexpected outbound host");
  };
  return { calls, fetchImpl };
}

test("analyzes an image and maps selected IDs to canonical candidates", async (t) => {
  let aiOptions;
  const { calls, fetchImpl } = mockFetch({ onAiRequest: (options) => { aiOptions = options; } });
  const app = buildApp({ config, fetchImpl, logger: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/ocr/analyze",
    headers: { ...multipartImage().headers, authorization: "Bearer user-token" },
    payload: multipartImage().payload,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.accountName, "Everyday Account");
  assert.equal(body.data.categoryName, "Restaurants");
  assert.equal(body.data.categoryId, 45);
  assert.equal(calls.length, 3);

  const aiRequest = JSON.parse(aiOptions.body);
  const serializedPrompt = JSON.stringify(aiRequest.messages);
  assert.equal(serializedPrompt.includes("999999"), false);
  assert.equal(serializedPrompt.includes("1234567890"), false);
  assert.equal(aiOptions.headers.Authorization, "Bearer test-ai-secret");
  assert.equal(aiOptions.headers.Authorization.includes("user-token"), false);
});

test("requires authorization before making outbound requests", async (t) => {
  const { calls, fetchImpl } = mockFetch();
  const app = buildApp({ config, fetchImpl, logger: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/ocr/analyze",
    headers: multipartImage().headers,
    payload: multipartImage().payload,
  });

  assert.equal(response.statusCode, 401);
  assert.equal(calls.length, 0);
});

test("allows browser requests only from the configured frontend origin", async (t) => {
  const { fetchImpl } = mockFetch();
  const app = buildApp({ config, fetchImpl, logger: false });
  t.after(() => app.close());

  const allowedResponse = await app.inject({
    method: "OPTIONS",
    url: "/v1/ocr/analyze",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  const deniedResponse = await app.inject({
    method: "OPTIONS",
    url: "/v1/ocr/analyze",
    headers: {
      origin: "https://untrusted.example",
      "access-control-request-method": "POST",
    },
  });

  assert.equal(allowedResponse.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal(deniedResponse.headers["access-control-allow-origin"], undefined);
});

test("does not return IDs that are absent from backend candidates", async (t) => {
  const { fetchImpl } = mockFetch({ analysis: validAnalysis({ accountId: 999, categoryId: 998 }) });
  const app = buildApp({ config, fetchImpl, logger: false });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/ocr/analyze",
    headers: { ...multipartImage().headers, authorization: "Bearer user-token" },
    payload: multipartImage().payload,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.accountId, null);
  assert.equal(response.json().data.accountName, null);
  assert.equal(response.json().data.categoryId, null);
  assert.equal(response.json().data.categoryName, null);
});

test("retrieves every backend page and forwards locale/document hints", async (t) => {
  const calls = [];
  let aiPrompt = "";
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    calls.push(url);
    if (url.hostname === "finance.example.test") {
      const isAccounts = url.pathname.endsWith("/accounts");
      const page = Number(url.searchParams.get("page"));
      const isSecondAccountPage = isAccounts && page === 2;
      return paginated(isSecondAccountPage ? [{ ...account, id: 13, name: "Savings Account" }] : [isAccounts ? account : category], page, isAccounts ? 2 : 1);
    }
    aiPrompt = JSON.parse(options.body).messages[1].content[0].text;
    return aiResponse(validAnalysis({ accountId: 13 }));
  };
  const app = buildApp({ config, fetchImpl, logger: false });
  t.after(() => app.close());
  const multipart = multipartImageWithHints();

  const response = await app.inject({
    method: "POST",
    url: "/v1/ocr/analyze",
    headers: { ...multipart.headers, authorization: "Bearer user-token" },
    payload: multipart.payload,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.accountName, "Savings Account");
  assert.equal(aiPrompt.includes("Document type hint: receipt"), true);
  assert.equal(aiPrompt.includes("Locale hint: id-ID"), true);
  assert.equal(calls.filter((url) => url.hostname === "finance.example.test" && url.pathname.endsWith("/accounts")).length, 2);
});