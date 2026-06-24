import type { FastifyReply } from "fastify";
import { z } from "zod";

export const tweetTextSchema = z
  .string()
  .trim()
  .min(1, "tweet_text is required")
  .max(280, "tweet_text must be 280 characters or fewer");

export const uuidSchema = z.string().uuid("must be a valid UUID");

export function sendValidationError(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
