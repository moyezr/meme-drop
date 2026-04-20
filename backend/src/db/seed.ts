import "dotenv/config";
import { db } from "./index.js";
import { users } from "./schema.js";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

async function seed() {
  await db
    .insert(users)
    .values({ id: DEV_USER_ID, email: "dev@memedrop.local" })
    .onConflictDoNothing();

  console.log("Seeded dev user.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
