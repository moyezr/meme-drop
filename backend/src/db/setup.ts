import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
console.log("pgvector extension enabled.");
await pool.end();
