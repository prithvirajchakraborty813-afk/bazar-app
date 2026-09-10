-- Run this once against your Neon database to create the tables.
-- In the Neon dashboard: open the SQL Editor, paste this in, run it.

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subcategories (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  subcategory_id INTEGER NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_items_subcategory ON items(subcategory_id);

-- Logs an item's OLD price every time it changes, so price-rise reports work.
-- Nothing is written retroactively for items that already existed before this
-- table was added — their history simply starts from their next edit.
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  old_price TEXT NOT NULL,
  new_price TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_price_history_item ON price_history(item_id);

-- Adjustable-length spending limits. scope is 'global' | 'category' | 'subcategory';
-- scope_id is NULL for global, otherwise the category/subcategory id.
-- Cycle is a rolling block of cycle_days starting at cycle_start; once "today"
-- passes cycle_start + cycle_days, the next cycle auto-renews from that boundary
-- (so history stays cleanly split into consecutive N-day blocks, forever, with
-- no manual reset needed).
CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'category', 'subcategory')),
  scope_id INTEGER,
  label TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  cycle_days INTEGER NOT NULL DEFAULT 30,
  cycle_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_scope ON budgets(scope, COALESCE(scope_id, -1));
