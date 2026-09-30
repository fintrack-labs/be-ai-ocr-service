function requiredString(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInteger(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function normalizeBaseUrl(raw, name, isProduction) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, query, or fragment`);
  }
  if (isProduction && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production`);
  }

  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

function allowedOrigins(env, isProduction) {
  const configured = env.CORS_ALLOWED_ORIGINS?.trim();
  if (isProduction && !configured) {
    throw new Error("CORS_ALLOWED_ORIGINS must be configured in production");
  }

  return (configured || "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error("CORS_ALLOWED_ORIGINS must contain valid origins");
      }
      if (url.origin !== value || !["http:", "https:"].includes(url.protocol) || (isProduction && url.protocol !== "https:")) {
        throw new Error("CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins; production origins must use HTTPS");
      }
      return url.origin;
    });
}

export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port: positiveInteger(env, "PORT", 3000),
    corsAllowedOrigins: allowedOrigins(env, isProduction),
    beAppBaseUrl: normalizeBaseUrl(requiredString(env, "BE_APP_BASE_URL"), "BE_APP_BASE_URL", isProduction),
    aiApiBaseUrl: normalizeBaseUrl(requiredString(env, "AI_API_BASE_URL"), "AI_API_BASE_URL", isProduction),
    aiApiKey: requiredString(env, "AI_API_KEY"),
    aiModel: requiredString(env, "AI_MODEL"),
    requestTimeoutMs: positiveInteger(env, "REQUEST_TIMEOUT_MS", 15000),
    maxImageBytes: positiveInteger(env, "MAX_IMAGE_BYTES", 10 * 1024 * 1024),
    masterDataPageSize: positiveInteger(env, "MASTER_DATA_PAGE_SIZE", 100),
  };
}