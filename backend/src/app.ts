import "dotenv/config";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { INSTALL_ID_HEADER } from "./routes/identity.js";
import { accountRoutes } from "./routes/account.js";
import { healthRoutes } from "./routes/health.js";
import { suggestRoutes } from "./routes/suggest.js";
import { libraryRoutes } from "./routes/library.js";
import { memesRoutes } from "./routes/memes.js";
import { usageRoutes } from "./routes/usage.js";

const REQUEST_ID_HEADER = "x-request-id";

export async function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? {
      level: process.env.MEMEDROP_LOG_LEVEL || (config.isProduction ? "info" : "debug"),
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        `req.headers.${INSTALL_ID_HEADER}`,
        "request.headers.authorization",
        "request.headers.cookie",
        `request.headers.${INSTALL_ID_HEADER}`,
      ],
    },
    bodyLimit: 512 * 1024,
    trustProxy: config.isProduction,
    genReqId: (request) => {
      const incoming = request.headers[REQUEST_ID_HEADER];
      const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
      return isSafeRequestId(candidate) ? candidate : randomUUID();
    },
    ...options,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const errorStatusCode = statusCodeForError(error);
    const errorMessage = messageForError(error);
    const statusCode =
      typeof errorStatusCode === "number" && errorStatusCode >= 400
        ? errorStatusCode
        : 500;
    const isServerError = statusCode >= 500;

    request.log[isServerError ? "error" : "warn"](
      { err: error, request_id: request.id, statusCode },
      "Request failed"
    );

    reply.status(statusCode).send({
      error: isServerError ? "Internal Server Error" : errorMessage,
      request_id: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: "Not Found",
      request_id: request.id,
    });
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin && !config.isProduction) {
        callback(null, true);
        return;
      }
      if (origin && config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", INSTALL_ID_HEADER, REQUEST_ID_HEADER],
  });
  await app.register(rateLimitPlugin);

  await app.register(fastifyStatic, {
    root: config.memeStoragePath,
    prefix: "/memes/",
    decorateReply: false,
  });

  await app.register(healthRoutes);
  await app.register(accountRoutes, { prefix: "/api/v1" });
  await app.register(suggestRoutes, { prefix: "/api/v1" });
  await app.register(libraryRoutes, { prefix: "/api/v1" });
  await app.register(memesRoutes, { prefix: "/api/v1" });
  await app.register(usageRoutes, { prefix: "/api/v1" });

  return app;
}

function isSafeRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function statusCodeForError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function messageForError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Request failed";
}
