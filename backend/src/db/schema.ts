import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

// Users table (minimal, no auth)
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Global seed meme database
export const memes = pgTable(
  "memes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    filePath: text("file_path").notNull(),
    formatType: text("format_type").notNull(),
    isEvergreen: boolean("is_evergreen").notNull().default(true),
    systemTags: jsonb("system_tags").notNull().default({}),
    embedding: vector("embedding", { dimensions: 1536 }),
    sourceUrl: text("source_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_memes_format_type").on(table.formatType)]
);

// User's personal meme library
export const userMemes = pgTable(
  "user_memes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    globalMemeId: uuid("global_meme_id").references(() => memes.id, {
      onDelete: "set null",
    }),
    filePath: text("file_path").notNull(),
    userName: text("user_name").notNull(),
    userTags: text("user_tags").array().notNull().default([]),
    systemTags: jsonb("system_tags").notNull().default({}),
    embedding: vector("embedding", { dimensions: 1536 }),
    useCount: integer("use_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_user_memes_user_id").on(table.userId)]
);

// Usage events for future personalization
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userMemeId: uuid("user_meme_id").references(() => userMemes.id, {
      onDelete: "set null",
    }),
    globalMemeId: uuid("global_meme_id").references(() => memes.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    tweetContext: jsonb("tweet_context").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_usage_events_user_id").on(table.userId)]
);
