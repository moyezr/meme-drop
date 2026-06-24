import type { FastifyPluginAsync } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { usageEvents, userMemes, users } from "../db/schema.js";
import { deleteStoredImage } from "../services/image-downloader.js";
import { requireInstallUserId } from "./identity.js";

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.get("/account/export", async (request, reply) => {
    const userId = await requireInstallUserId(request, reply);
    if (!userId) return;

    const [library, usage] = await Promise.all([
      db
        .select()
        .from(userMemes)
        .where(eq(userMemes.userId, userId)),
      db
        .select()
        .from(usageEvents)
        .where(eq(usageEvents.userId, userId)),
    ]);

    return {
      install_id: userId,
      exported_at: new Date().toISOString(),
      library,
      usage_events: usage,
    };
  });

  app.delete("/account", async (request, reply) => {
    const userId = await requireInstallUserId(request, reply);
    if (!userId) return;

    const savedMemes = await db
      .select({ id: userMemes.id, filePath: userMemes.filePath })
      .from(userMemes)
      .where(eq(userMemes.userId, userId));

    let deletedFiles = 0;
    for (const meme of savedMemes) {
      try {
        if (await deleteStoredImage(meme.filePath)) deletedFiles++;
      } catch (err) {
        request.log.warn({ err, memeId: meme.id }, "Failed to delete stored meme file");
      }
    }

    const deletedUsage = await db
      .delete(usageEvents)
      .where(eq(usageEvents.userId, userId))
      .returning({ id: usageEvents.id });

    const deletedMemes = await db
      .delete(userMemes)
      .where(eq(userMemes.userId, userId))
      .returning({ id: userMemes.id });

    const deletedUsers = await db
      .delete(users)
      .where(and(eq(users.id, userId), eq(users.email, `install-${userId}@anonymous.memedrop.local`)))
      .returning({ id: users.id });

    return {
      deleted: true,
      install_id: userId,
      deleted_library_items: deletedMemes.length,
      deleted_usage_events: deletedUsage.length,
      deleted_files: deletedFiles,
      deleted_account: deletedUsers.length > 0,
    };
  });
};
