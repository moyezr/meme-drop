import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { healthRoutes } from "./routes/health.js";
import { suggestRoutes } from "./routes/suggest.js";
import { libraryRoutes } from "./routes/library.js";
import { memesRoutes } from "./routes/memes.js";
import { usageRoutes } from "./routes/usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "..", "data", "memes"),
  prefix: "/memes/",
  decorateReply: false,
});

await app.register(healthRoutes);
await app.register(suggestRoutes, { prefix: "/api/v1" });
await app.register(libraryRoutes, { prefix: "/api/v1" });
await app.register(memesRoutes, { prefix: "/api/v1" });
await app.register(usageRoutes, { prefix: "/api/v1" });

const port = parseInt(process.env.PORT || "3001", 10);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
