import { ServiceError } from "../errors.js";

const MAX_PAGE_COUNT = 100;

async function fetchPage({ resource, baseUrl, authorization, pageSize, timeoutMs, fetchImpl, page }) {
  const url = new URL(resource, baseUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("sortBy", "id");
  url.searchParams.set("sortOrder", "ASC");

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: authorization, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ServiceError(504, "BE_TIMEOUT", "The finance backend request timed out.");
    }
    throw new ServiceError(502, "BE_UNAVAILABLE", "The finance backend is unavailable.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ServiceError(response.status, "BE_AUTH_REJECTED", "The finance backend rejected the access token.");
    }
    throw new ServiceError(502, "BE_REQUEST_FAILED", "The finance backend could not provide master data.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ServiceError(502, "BE_INVALID_RESPONSE", "The finance backend returned an invalid response.");
  }

  if (
    !payload ||
    !Array.isArray(payload.data) ||
    !Number.isSafeInteger(payload.pageCount) ||
    payload.pageCount < 0
  ) {
    throw new ServiceError(502, "BE_INVALID_RESPONSE", "The finance backend returned an invalid paginated response.");
  }

  if (payload.pageCount > MAX_PAGE_COUNT) {
    throw new ServiceError(502, "BE_TOO_MANY_PAGES", "The finance backend returned too many pages.");
  }
  return payload;
}

async function fetchCollection(options, page = 1, records = []) {
  const payload = await fetchPage({ ...options, page });
  const allRecords = records.concat(payload.data);
  if (page >= payload.pageCount) return allRecords;
  return fetchCollection(options, page + 1, allRecords);
}

export async function fetchMasterData({ authorization, config, fetchImpl }) {
  const [accounts, categories] = await Promise.all([
    fetchCollection({
      resource: "accounts",
      baseUrl: config.beAppBaseUrl,
      authorization,
      pageSize: config.masterDataPageSize,
      timeoutMs: config.requestTimeoutMs,
      fetchImpl,
    }),
    fetchCollection({
      resource: "categories",
      baseUrl: config.beAppBaseUrl,
      authorization,
      pageSize: config.masterDataPageSize,
      timeoutMs: config.requestTimeoutMs,
      fetchImpl,
    }),
  ]);

  return { accounts, categories };
}