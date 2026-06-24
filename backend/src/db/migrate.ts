import "dotenv/config";
import pg from "pg";
import { usageActionCheckConstraintSql } from "./usage-actions.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

try {
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.usage_events') IS NOT NULL THEN
        ALTER TABLE usage_events
          DROP CONSTRAINT IF EXISTS usage_events_action_check,
          ADD CONSTRAINT usage_events_action_check CHECK (${usageActionCheckConstraintSql()});
      END IF;
    END $$;
  `);
  console.log("usage_events action constraint migrated.");
} finally {
  await pool.end();
}
