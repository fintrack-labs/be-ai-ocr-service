import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { analyzeRoute } from "./routes/analyze.js";
import { ServiceError } from "./errors.js";

export function buildApp({ config, fetchImpl = fetch, logger = true }) {
  const app = Fastify({
    logger: logger
      ? {
          redact: {
            paths: ["req.headers.authorization", "req.headers.cookie"],
            censor: "[REDACTED]",
          },
        }
      : false,
    bodyLimit: config.maxImageBytes + 1024 * 1024,
  });

  app.register(cors, {
    origin: config.corsAllowedOrigins ?? [],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });

  app.register(multipart, {
    limits: {
      fileSize: config.maxImageBytes,
      files: 1,
      fields: 2,
      parts: 3,
    },
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.register(async (scopedApp) => analyzeRoute(scopedApp, { config, fetchImpl }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ServiceError) {
      request.log?.warn?.(
        { code: error.code, statusCode: error.statusCode },
        "OCR request failed",
      );
      return reply.code(error.statusCode).send({
        success: false,
        message: error.message,
        data: null,
      });
    }

    if (error.statusCode === 413 || error.code === "FST_REQ_FILE_TOO_LARGE") {
      request.log?.warn?.(
        { code: error.code ?? "FILE_TOO_LARGE", statusCode: 413 },
        "OCR image rejected",
      );
      return reply.code(413).send({ success: false, message: "The image exceeds the configured size limit.", data: null });
    }

    if (error.statusCode && error.statusCode < 500) {
      request.log?.warn?.(
        { code: error.code ?? "INVALID_REQUEST", statusCode: error.statusCode },
        "OCR request rejected",
      );
      return reply.code(error.statusCode).send({ success: false, message: "The request is invalid.", data: null });
    }

    request.log?.error?.({ code: error.code ?? "INTERNAL_ERROR" }, "Request processing failed");
    return reply.code(500).send({ success: false, message: "An internal error occurred.", data: null });
  });

  return app;
}