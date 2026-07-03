-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table (minimal, no auth)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Global seed meme database
CREATE TABLE IF NOT EXISTS memes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  file_path text NOT NULL,
  format_type text NOT NULL CHECK (format_type IN ('reaction_image', 'text_overlay')),
  is_evergreen boolean NOT NULL DEFAULT true,
  system_tags jsonb NOT NULL DEFAULT '{}',
  embedding vector(1536),
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- User's personal meme library
CREATE TABLE IF NOT EXISTS user_memes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  global_meme_id uuid REFERENCES memes(id) ON DELETE SET NULL,
  file_path text NOT NULL,
  user_name text NOT NULL,
  user_tags text[] NOT NULL DEFAULT '{}',
  system_tags jsonb NOT NULL DEFAULT '{}',
  embedding vector(1536),
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Usage events for analytics and recommendation feedback.
CREATE TABLE IF NOT EXISTS usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_meme_id uuid REFERENCES user_memes(id) ON DELETE SET NULL,
  global_meme_id uuid REFERENCES memes(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('suggested', 'shown', 'clicked', 'used', 'inserted', 'saved', 'dismissed')),
  tweet_context jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_memes_user_id ON user_memes(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_user_action_created_at ON usage_events(user_id, action, created_at);
CREATE INDEX IF NOT EXISTS idx_memes_format_type ON memes(format_type);
CREATE INDEX IF NOT EXISTS idx_memes_embedding_hnsw ON memes USING hnsw (embedding vector_cosine_ops);

-- Insert a default dev user (no auth, so we need one to work with)
INSERT INTO users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'dev@memedrop.local')
ON CONFLICT (email) DO NOTHING;
