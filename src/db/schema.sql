-- Awards Voting Schema

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_open BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nominees (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS votes (
  id SERIAL PRIMARY KEY,
  nominee_id INTEGER REFERENCES nominees(id) ON DELETE CASCADE,
  voter_name TEXT,
  voter_phone TEXT,
  vote_count INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL, -- in kobo
  payment_ref TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending', -- pending | success | failed
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO settings (key, value) VALUES ('price_per_vote_kobo', '10000')
  ON CONFLICT (key) DO NOTHING; -- ₦100 per vote default

CREATE INDEX IF NOT EXISTS idx_nominees_category ON nominees(category_id);
CREATE INDEX IF NOT EXISTS idx_votes_nominee ON votes(nominee_id);
CREATE INDEX IF NOT EXISTS idx_votes_status ON votes(status);
