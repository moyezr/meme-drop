import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { config } from "../config.js";
import { uuidSchema } from "./validation.js";

export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
export const INSTALL_ID_HEADER = "x-memedrop-install-id";

export async function resolveRequestUserId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const raw = request.headers[INSTALL_ID_HEADER];
  const installId = Array.isArray(raw) ? raw[0] : raw;

  if (!installId) {
    if (config.requireInstallId) {
      reply.code(401).send({ error: `${INSTALL_ID_HEADER} is required` });
      return null;
    }
    return DEV_USER_ID;
  }

  const parsed = uuidSchema.safeParse(installId);
  if (!parsed.success) {
    reply.code(400).send({ error: `${INSTALL_ID_HEADER} must be a UUID` });
    return null;
  }

  await db
    .insert(users)
    .values({
      id: parsed.data,
      email: `install-${parsed.data}@anonymous.memedrop.local`,
    })
    .onConflictDoNothing();

  return parsed.data;
}

export async function requireInstallUserId(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<string | null> {
  const raw = request.headers[INSTALL_ID_HEADER];
  const installId = Array.isArray(raw) ? raw[0] : raw;

  if (!installId) {
    reply.code(401).send({ error: `${INSTALL_ID_HEADER} is required` });
    return null;
  }

  const parsed = uuidSchema.safeParse(installId);
  if (!parsed.success) {
    reply.code(400).send({ error: `${INSTALL_ID_HEADER} must be a UUID` });
    return null;
  }

  return parsed.data;
}
