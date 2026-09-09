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

-- A price edit is kept as an audit record, so reports can show a real
-- increase instead of only the current price on the item.
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  old_price TEXT NOT NULL DEFAULT '',
  new_price TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Budgets may cover everything, one category, or one subcategory.  The
-- period is intentionally expressed in days so a user can use 12, 34, 60,
-- or any other recurring window rather than being forced into a month.
CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'category', 'subcategory')),
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  period_days INTEGER NOT NULL CHECK (period_days BETWEEN 1 AND 3650),
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'global' AND category_id IS NULL AND subcategory_id IS NULL)
    OR (scope = 'category' AND category_id IS NOT NULL AND subcategory_id IS NULL)
    OR (scope = 'subcategory' AND subcategory_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_items_subcategory ON items(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_price_history_item ON price_history(item_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_budgets_scope ON budgets(scope, category_id, subcategory_id);
