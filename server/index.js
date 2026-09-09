import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(cors());
app.use(express.json());

const requireAdmin = (req, res, next) => {
  const password = req.headers["x-admin-password"];
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong admin password." });
  }
  next();
};

// ---------- Auth ----------
app.post("/api/login", (req, res) => {
  const { role, password } = req.body;
  if (role === "admin") {
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Wrong admin password." });
    }
    return res.json({ role: "admin" });
  }
  res.json({ role: "general" });
});

// ---------- Read full catalog tree (used by both General and Admin views) ----------
app.get("/api/catalog", async (req, res) => {
  try {
    const categories = await sql`SELECT id, name FROM categories ORDER BY created_at`;
    const subcategories = await sql`SELECT id, category_id, name FROM subcategories ORDER BY created_at`;
    const items = await sql`SELECT id, subcategory_id, name, price, description, image_url FROM items ORDER BY created_at`;

    const tree = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      subs: subcategories
        .filter((s) => s.category_id === cat.id)
        .map((sub) => ({
          id: sub.id,
          name: sub.name,
          items: items
            .filter((it) => it.subcategory_id === sub.id)
            .map((it) => ({
              id: it.id,
              name: it.name,
              price: it.price,
              desc: it.description,
              img: it.image_url,
            })),
        })),
    }));

    res.json(tree);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load catalog." });
  }
});

// ---------- Categories ----------
app.post("/api/categories", requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Category name is required." });
  const [row] = await sql`INSERT INTO categories (name) VALUES (${name.trim()}) RETURNING id, name`;
  res.json(row);
});

app.delete("/api/categories/:id", requireAdmin, async (req, res) => {
  await sql`DELETE FROM categories WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

// ---------- Subcategories ----------
app.post("/api/subcategories", requireAdmin, async (req, res) => {
  const { categoryId, name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Subcategory name is required." });
  const [row] = await sql`INSERT INTO subcategories (category_id, name) VALUES (${categoryId}, ${name.trim()}) RETURNING id, name`;
  res.json(row);
});

app.delete("/api/subcategories/:id", requireAdmin, async (req, res) => {
  await sql`DELETE FROM subcategories WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

// ---------- Items ----------
app.post("/api/items", requireAdmin, async (req, res) => {
  const { subcategoryId, name, price, desc, img } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Item name is required." });
  const [row] = await sql`
    INSERT INTO items (subcategory_id, name, price, description, image_url)
    VALUES (${subcategoryId}, ${name.trim()}, ${price || ""}, ${desc || ""}, ${img || ""})
    RETURNING id, name, price, description AS desc, image_url AS img`;
  res.json(row);
});

app.put("/api/items/:id", requireAdmin, async (req, res) => {
  const { name, price, desc, img } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Item name is required." });

  const [current] = await sql`
    SELECT id, price FROM items WHERE id = ${req.params.id}`;
  if (!current) return res.status(404).json({ error: "Item not found." });

  const [row] = await sql`
    UPDATE items SET name = ${name.trim()}, price = ${price || ""}, description = ${desc || ""}, image_url = ${img || ""}
    WHERE id = ${req.params.id}
    RETURNING id, name, price, description AS desc, image_url AS img`;

  if (String(current.price || "") !== String(price || "")) {
    await sql`
      INSERT INTO price_history (item_id, old_price, new_price)
      VALUES (${current.id}, ${current.price || ""}, ${price || ""})`;
  }
  res.json(row);
});

app.delete("/api/items/:id", requireAdmin, async (req, res) => {
  await sql`DELETE FROM items WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

// ---------- Spend summary ----------
// Treats each item's price as money spent on the day it was added, and
// totals that up for "today", "this month", and "the last 3 months", plus
// a per-day breakdown for the last 30 days and a paginated item-by-item
// log (with exact date/time) so the admin can see a trend or drill into
// exactly when each purchase happened. The log's time range and page are
// controlled by ?range= (30d | 3m | 6m | 1y | all, default 3m) and
// ?offset= (default 0) query params, so nothing is silently cut off —
// older entries are just a "Load more" click away.
// Price is stored as TEXT (so it can hold "", partial input, etc. while
// editing), so this strips anything that isn't a digit or a dot before
// summing — non-numeric prices just contribute 0.
const RANGE_CUTOFFS = {
  "30d": () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  "3m": () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d; },
  "6m": () => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d; },
  "1y": () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; },
  all: () => new Date(0),
};
const ENTRIES_PAGE_SIZE = 100;

app.get("/api/spend-summary", requireAdmin, async (req, res) => {
  try {
    const toNumber = (row) => Number(row.total) || 0;

    const [todayRow] = await sql`
      SELECT COALESCE(SUM(NULLIF(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric), 0) AS total
      FROM items WHERE created_at >= date_trunc('day', now())`;

    const [monthRow] = await sql`
      SELECT COALESCE(SUM(NULLIF(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric), 0) AS total
      FROM items WHERE created_at >= date_trunc('month', now())`;

    const [threeMonthRow] = await sql`
      SELECT COALESCE(SUM(NULLIF(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric), 0) AS total
      FROM items WHERE created_at >= now() - interval '3 months'`;

    const daily = await sql`
      SELECT date_trunc('day', created_at) AS day,
             COALESCE(SUM(NULLIF(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric), 0) AS total
      FROM items
      WHERE created_at >= now() - interval '30 days'
      GROUP BY day
      ORDER BY day DESC`;

    // Individual entries (item + exact date/time it was added), most recent first.
    const range = RANGE_CUTOFFS[req.query.range] ? req.query.range : "3m";
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const cutoff = RANGE_CUTOFFS[range]();

    const entries = await sql`
      SELECT i.name, i.price, i.created_at,
             s.name AS subcategory, c.name AS category
      FROM items i
      JOIN subcategories s ON s.id = i.subcategory_id
      JOIN categories c ON c.id = s.category_id
      WHERE i.created_at >= ${cutoff.toISOString()}
      ORDER BY i.created_at DESC
      LIMIT ${ENTRIES_PAGE_SIZE + 1} OFFSET ${offset}`;

    const hasMore = entries.length > ENTRIES_PAGE_SIZE;
    const pageEntries = hasMore ? entries.slice(0, ENTRIES_PAGE_SIZE) : entries;

    res.json({
      today: toNumber(todayRow),
      thisMonth: toNumber(monthRow),
      last3Months: toNumber(threeMonthRow),
      daily: daily.map((d) => ({ day: d.day, total: toNumber(d) })),
      entries: pageEntries.map((e) => ({
        name: e.name,
        price: e.price,
        createdAt: e.created_at,
        subcategory: e.subcategory,
        category: e.category,
      })),
      range,
      offset,
      hasMore,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load spend summary." });
  }
});

// ---------- Reports, price changes, and flexible budgets ----------
// An item row represents a purchase in this app.  Keeping the calculation in
// JavaScript makes the category/subcategory/global report use exactly the same
// rules, while still allowing prices such as "Rs 35" in old records.
const moneyFromText = (value) => {
  const amount = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateStartUtc = (value) => {
  if (!ISO_DATE.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const formatIsoDate = (date) => date.toISOString().slice(0, 10);
const addUtcDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const reportDates = (query) => {
  const now = new Date();
  const defaultFrom = addUtcDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -29);
  const from = query.from ? dateStartUtc(query.from) : defaultFrom;
  const toDay = query.to ? dateStartUtc(query.to) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!from || !toDay || from > toDay) return null;
  return { from, toDay, endExclusive: addUtcDays(toDay, 1) };
};

const scopeMatches = (entry, scope, scopeId) =>
  scope === "global" ||
  (scope === "category" && entry.categoryId === scopeId) ||
  (scope === "subcategory" && entry.subcategoryId === scopeId);

const getPurchases = async () => {
  const rows = await sql`
    SELECT i.id, i.name, i.price, i.created_at,
           s.id AS subcategory_id, s.name AS subcategory,
           c.id AS category_id, c.name AS category
    FROM items i
    JOIN subcategories s ON s.id = i.subcategory_id
    JOIN categories c ON c.id = s.category_id
    ORDER BY i.created_at ASC, i.id ASC`;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    amount: moneyFromText(row.price),
    createdAt: new Date(row.created_at),
    categoryId: Number(row.category_id),
    category: row.category,
    subcategoryId: Number(row.subcategory_id),
    subcategory: row.subcategory,
  }));
};

const groupBy = (rows, key) => {
  const groups = new Map();
  rows.forEach((row) => {
    const value = key(row);
    groups.set(value, [...(groups.get(value) || []), row]);
  });
  return groups;
};

const reportPriceEdits = async (scope, scopeId, dates) => {
  const rows = await sql`
    SELECT h.old_price, h.new_price, h.changed_at, i.name,
           s.id AS subcategory_id, s.name AS subcategory,
           c.id AS category_id, c.name AS category
    FROM price_history h
    JOIN items i ON i.id = h.item_id
    JOIN subcategories s ON s.id = i.subcategory_id
    JOIN categories c ON c.id = s.category_id
    WHERE h.changed_at >= ${dates.from.toISOString()}
      AND h.changed_at < ${dates.endExclusive.toISOString()}
    ORDER BY h.changed_at DESC`;
  return rows
    .map((row) => ({
      name: row.name,
      oldPrice: row.old_price,
      newPrice: row.new_price,
      oldAmount: moneyFromText(row.old_price),
      newAmount: moneyFromText(row.new_price),
      changedAt: row.changed_at,
      categoryId: Number(row.category_id),
      category: row.category,
      subcategoryId: Number(row.subcategory_id),
      subcategory: row.subcategory,
      source: "price edit",
    }))
    .filter((row) => row.newAmount > row.oldAmount && scopeMatches(row, scope, scopeId));
};

app.get("/api/reports", requireAdmin, async (req, res) => {
  const scope = String(req.query.scope || "global");
  const scopeId = Number(req.query.id);
  const dates = reportDates(req.query);
  if (!['global', 'category', 'subcategory'].includes(scope)) {
    return res.status(400).json({ error: "Report scope must be global, category, or subcategory." });
  }
  if (scope !== "global" && (!Number.isInteger(scopeId) || scopeId < 1)) {
    return res.status(400).json({ error: "A category or subcategory id is required." });
  }
  if (!dates) return res.status(400).json({ error: "Choose a valid date range." });

  try {
    const allPurchases = await getPurchases();
    const purchases = allPurchases.filter((entry) =>
      entry.createdAt >= dates.from &&
      entry.createdAt < dates.endExclusive &&
      scopeMatches(entry, scope, scopeId));

    // Drill down one level: global -> categories, category -> subcategories,
    // subcategory -> individual items.
    const breakdownKey = scope === "global"
      ? (entry) => `category:${entry.categoryId}`
      : scope === "category"
        ? (entry) => `subcategory:${entry.subcategoryId}`
        : (entry) => `item:${entry.name.trim().toLocaleLowerCase()}`;
    const breakdown = [...groupBy(purchases, breakdownKey).values()]
      .map((entries) => ({
        id: scope === "global" ? entries[0].categoryId : scope === "category" ? entries[0].subcategoryId : null,
        name: scope === "global" ? entries[0].category : scope === "category" ? entries[0].subcategory : entries[0].name,
        spend: entries.reduce((sum, entry) => sum + entry.amount, 0),
        purchases: entries.length,
      }))
      .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));

    const repeatedItems = [...groupBy(purchases, (entry) => entry.name.trim().toLocaleLowerCase()).values()]
      .filter((entries) => entries.length > 1)
      .map((entries) => ({
        name: entries[0].name,
        purchases: entries.length,
        spend: entries.reduce((sum, entry) => sum + entry.amount, 0),
        category: entries[0].category,
        subcategory: entries[0].subcategory,
        lastBoughtAt: entries[entries.length - 1].createdAt,
      }))
      .sort((a, b) => b.purchases - a.purchases || b.spend - a.spend)
      .slice(0, 50);

    // Price rises are detected both for repeated purchases and explicit edits.
    const purchasePriceRises = [];
    groupBy(purchases, (entry) => entry.name.trim().toLocaleLowerCase()).forEach((entries) => {
      let previous = null;
      entries.forEach((entry) => {
        if (previous && entry.amount > previous.amount) {
          purchasePriceRises.push({
            name: entry.name,
            oldPrice: previous.price,
            newPrice: entry.price,
            oldAmount: previous.amount,
            newAmount: entry.amount,
            changedAt: entry.createdAt,
            category: entry.category,
            subcategory: entry.subcategory,
            source: "repeat purchase",
          });
        }
        previous = entry;
      });
    });
    const priceIncreases = [...purchasePriceRises, ...(await reportPriceEdits(scope, scopeId, dates))]
      .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))
      .slice(0, 50)
      .map((entry) => ({ ...entry, increase: entry.newAmount - entry.oldAmount }));

    const selectedName = scope === "global"
      ? "All spending"
      : allPurchases.find((entry) => scopeMatches(entry, scope, scopeId))?.[scope] || "Selected scope";
    const inclusiveDays = Math.round((dates.toDay - dates.from) / (24 * 60 * 60 * 1000)) + 1;
    const total = purchases.reduce((sum, entry) => sum + entry.amount, 0);

    res.json({
      scope,
      scopeId: scope === "global" ? null : scopeId,
      scopeName: selectedName,
      from: formatIsoDate(dates.from),
      to: formatIsoDate(dates.toDay),
      days: inclusiveDays,
      total,
      averagePerDay: total / inclusiveDays,
      purchaseCount: purchases.length,
      breakdown,
      repeatedItems,
      priceIncreases,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load this report." });
  }
});

const getBudgetCycle = (budget) => {
  const start = dateStartUtc(String(budget.start_date).slice(0, 10));
  const today = new Date();
  const todayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const rawDays = Math.floor((todayStart - start) / (24 * 60 * 60 * 1000));
  const cycleIndex = Math.max(0, Math.floor(rawDays / Number(budget.period_days)));
  const cycleStart = addUtcDays(start, cycleIndex * Number(budget.period_days));
  return {
    cycleStart,
    cycleEnd: addUtcDays(cycleStart, Number(budget.period_days)),
    cycleNumber: cycleIndex + 1,
  };
};

const getBudgetStatuses = async () => {
  const [budgetRows, purchases] = await Promise.all([
    sql`
      SELECT b.*, c.name AS category_name, s.name AS subcategory_name
      FROM budgets b
      LEFT JOIN categories c ON c.id = b.category_id
      LEFT JOIN subcategories s ON s.id = b.subcategory_id
      ORDER BY b.created_at DESC`,
    getPurchases(),
  ]);

  return budgetRows.map((budget) => {
    const cycle = getBudgetCycle(budget);
    const scopeId = budget.scope === "category" ? Number(budget.category_id) : Number(budget.subcategory_id);
    const relevant = purchases.filter((entry) =>
      entry.createdAt >= cycle.cycleStart &&
      entry.createdAt < cycle.cycleEnd &&
      scopeMatches(entry, budget.scope, scopeId));
    const spend = relevant.reduce((sum, entry) => sum + entry.amount, 0);
    const amount = Number(budget.amount);
    return {
      id: budget.id,
      scope: budget.scope,
      scopeId: budget.scope === "global" ? null : scopeId,
      scopeName: budget.scope === "global"
        ? "All spending"
        : budget.scope === "category" ? budget.category_name : budget.subcategory_name,
      amount,
      periodDays: Number(budget.period_days),
      startDate: String(budget.start_date).slice(0, 10),
      cycleStart: formatIsoDate(cycle.cycleStart),
      cycleEnd: formatIsoDate(addUtcDays(cycle.cycleEnd, -1)),
      cycleNumber: cycle.cycleNumber,
      spend,
      remaining: amount - spend,
      percent: amount === 0 ? (spend > 0 ? 100 : 0) : Math.round((spend / amount) * 100),
      isOver: spend > amount,
      purchaseCount: relevant.length,
    };
  });
};

const validateBudget = (body) => {
  const scope = String(body.scope || "");
  const amount = Number(body.amount);
  const periodDays = Number(body.periodDays);
  const scopeId = Number(body.scopeId);
  const startDate = body.startDate || formatIsoDate(new Date());
  if (!['global', 'category', 'subcategory'].includes(scope)) return { error: "Choose a valid budget scope." };
  if (!Number.isFinite(amount) || amount < 0) return { error: "Budget amount must be zero or more." };
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 3650) return { error: "Budget period must be between 1 and 3650 days." };
  if (!dateStartUtc(startDate)) return { error: "Choose a valid budget start date." };
  if (scope !== "global" && (!Number.isInteger(scopeId) || scopeId < 1)) return { error: "Choose a category or subcategory." };
  return { scope, amount, periodDays, scopeId, startDate };
};

app.get("/api/budgets", requireAdmin, async (_req, res) => {
  try {
    res.json(await getBudgetStatuses());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load budgets." });
  }
});

app.get("/api/budgets/status", requireAdmin, async (_req, res) => {
  try {
    res.json(await getBudgetStatuses());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load budget status." });
  }
});

app.post("/api/budgets", requireAdmin, async (req, res) => {
  const budget = validateBudget(req.body);
  if (budget.error) return res.status(400).json({ error: budget.error });
  try {
    const [row] = await sql`
      INSERT INTO budgets (scope, category_id, subcategory_id, amount, period_days, start_date)
      VALUES (
        ${budget.scope},
        ${budget.scope === "category" ? budget.scopeId : null},
        ${budget.scope === "subcategory" ? budget.scopeId : null},
        ${budget.amount}, ${budget.periodDays}, ${budget.startDate}
      )
      RETURNING id`;
    const status = (await getBudgetStatuses()).find((item) => item.id === row.id);
    res.status(201).json(status);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save budget. Check the selected scope still exists." });
  }
});

app.put("/api/budgets/:id", requireAdmin, async (req, res) => {
  const budget = validateBudget(req.body);
  if (budget.error) return res.status(400).json({ error: budget.error });
  try {
    const [row] = await sql`
      UPDATE budgets
      SET scope = ${budget.scope},
          category_id = ${budget.scope === "category" ? budget.scopeId : null},
          subcategory_id = ${budget.scope === "subcategory" ? budget.scopeId : null},
          amount = ${budget.amount}, period_days = ${budget.periodDays}, start_date = ${budget.startDate}
      WHERE id = ${req.params.id}
      RETURNING id`;
    if (!row) return res.status(404).json({ error: "Budget not found." });
    const status = (await getBudgetStatuses()).find((item) => item.id === row.id);
    res.json(status);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update budget." });
  }
});

app.delete("/api/budgets/:id", requireAdmin, async (req, res) => {
  try {
    await sql`DELETE FROM budgets WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not remove budget." });
  }
});

const fallbackBudgetAdvice = (budget) => {
  const overBy = Math.max(0, budget.spend - budget.amount);
  return [
    `You are over this ${budget.periodDays}-day budget by ${overBy.toFixed(2)}. Pause non-essential purchases in this scope until ${budget.cycleEnd}.`,
    `Set a practical remaining cap of 0 for this cycle, then review the repeat-purchase section to delay one repeat item where possible.`,
    `For the next cycle, use the report's price-increase list to compare alternatives before buying items that became more expensive.`,
  ];
};

app.post("/api/budgets/:id/advice", requireAdmin, async (req, res) => {
  try {
    const budget = (await getBudgetStatuses()).find((item) => item.id === Number(req.params.id));
    if (!budget) return res.status(404).json({ error: "Budget not found." });
    if (!budget.isOver) return res.json({ advice: ["This budget is still within its limit. Keep checking the report as the cycle progresses."], source: "local" });

    const fallback = fallbackBudgetAdvice(budget);
    if (!process.env.GROQ_API_KEY) return res.json({ advice: fallback, source: "local" });

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        temperature: 0.3,
        max_tokens: 220,
        messages: [
          { role: "system", content: "Give exactly three short, practical, non-judgmental budgeting suggestions. Do not give financial, medical, or legal advice. Respond as a JSON array of strings only." },
          { role: "user", content: `A ${budget.scopeName} spending budget is ${budget.amount} for ${budget.periodDays} days. Current cycle spend is ${budget.spend}, over by ${Math.max(0, budget.spend - budget.amount)}. The cycle ends ${budget.cycleEnd}.` },
        ],
      }),
    });
    if (!groqResponse.ok) return res.json({ advice: fallback, source: "local" });
    const raw = (await groqResponse.json()).choices?.[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const advice = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 3) : fallback;
    res.json({ advice: advice.length ? advice : fallback, source: advice.length ? "ai" : "local" });
  } catch (err) {
    console.error(err);
    res.json({ advice: ["Review repeat purchases and delay non-essential items until the next cycle."], source: "local" });
  }
});

// ---------- Speech-to-text (Groq-hosted Whisper, free tier) ----------
// Admin's recorded audio clip comes in here as a file upload. We send it to
// Groq's free, OpenAI-compatible endpoint for transcription, then hand the
// text to /api/voice-command below (same endpoint the browser-STT version used).
app.post("/api/transcribe", requireAdmin, upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No audio received." });

  try {
    const form = new FormData();
    form.append("file", new Blob([req.file.buffer], { type: req.file.mimetype || "audio/wav" }), "command.wav");
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "en");
    form.append("response_format", "json");

    const asrResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    });

    if (!asrResponse.ok) {
      const errText = await asrResponse.text();
      console.error("ASR error:", errText);
      return res.status(502).json({ error: "Speech service unavailable." });
    }

    const asrData = await asrResponse.json();
    const transcript = asrData.text?.trim();
    if (!transcript) return res.status(422).json({ error: "Could not hear anything clear." });

    res.json({ transcript });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Transcription failed." });
  }
});

// ---------- Voice command (Groq-hosted LLM) ----------
// Admin says something like "add item Alu price 25 to Bazar" (already transcribed to text
// by /api/transcribe above). This sends that text to a Groq-hosted LLM, asks it to return
// a strict JSON action, then applies it to the database.
app.post("/api/voice-command", requireAdmin, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript?.trim()) return res.status(400).json({ error: "No speech text received." });

  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content:
              'You convert spoken admin commands into strict JSON for a catalog app with Category -> Subcategory -> Item. ' +
              'Categories are added manually in the admin panel, never by voice — do not produce an add_category action. ' +
              'Reply with ONLY JSON, no prose, no markdown fences. ' +
              'Two supported shapes: ' +
              '{"action":"add_subcategory","category":"Family","subcategory":"Electricity"} ' +
              '— used for phrasing like "add subcategory X under/in/to Y". ' +
              'or {"action":"add_item","item":"Rice","price":"30","subcategory":"Bazar","category":"","desc":"","img":""} ' +
              '— used for phrasing like "add item X price Y to Z". The category field is usually NOT spoken for items — ' +
              'leave it as an empty string unless the command explicitly names both a subcategory and its parent category ' +
              '(e.g. "...to Bazar in Family"). Never guess or invent a category for add_item. ' +
              'or {"action":"unknown"} if the command does not match a supported action. ' +
              "Price should be digits only, no currency symbol. Infer subcategory names from what's spoken even if approximate, " +
              "including fixing obvious mishearings or spelling variants (e.g. spoken \"bazaar\" likely means \"Bazar\").",
          },
          { role: "user", content: transcript },
        ],
        temperature: 0,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      console.error("Groq LLM error:", errText);
      return res.status(502).json({ error: "Voice service unavailable." });
    }

    const groqData = await groqResponse.json();
    const raw = groqData.choices?.[0]?.message?.content?.trim() || "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(422).json({ error: "Could not understand that command." });
    }

    if (parsed.action === "unknown" || !parsed.action) {
      return res.status(422).json({ error: "Didn't recognize that as a command." });
    }

    if (parsed.action === "add_category") {
      return res.status(422).json({ error: "Add new categories manually from the admin panel, not by voice." });
    }

    if (parsed.action === "add_subcategory") {
      const [cat] = await sql`SELECT id FROM categories WHERE name ILIKE ${parsed.category} LIMIT 1`;
      if (!cat) return res.status(404).json({ error: `Category "${parsed.category}" not found.` });
      const [row] = await sql`INSERT INTO subcategories (category_id, name) VALUES (${cat.id}, ${parsed.subcategory}) RETURNING id, name`;
      return res.json({ applied: parsed, result: row });
    }

    if (parsed.action === "add_item") {
      // Category is optional here — most spoken item commands only name the
      // subcategory ("add item rice price 30 to bazar"). If a category was
      // given, use it to disambiguate; otherwise match on subcategory name alone.
      const matches = parsed.category?.trim()
        ? await sql`
            SELECT s.id, s.name AS sub_name, c.name AS cat_name FROM subcategories s
            JOIN categories c ON c.id = s.category_id
            WHERE s.name ILIKE ${parsed.subcategory} AND c.name ILIKE ${parsed.category}`
        : await sql`
            SELECT s.id, s.name AS sub_name, c.name AS cat_name FROM subcategories s
            JOIN categories c ON c.id = s.category_id
            WHERE s.name ILIKE ${parsed.subcategory}`;

      if (matches.length === 0) {
        return res.status(404).json({
          error: parsed.category
            ? `Subcategory "${parsed.subcategory}" not found under "${parsed.category}".`
            : `Subcategory "${parsed.subcategory}" not found.`,
        });
      }
      if (matches.length > 1) {
        const options = matches.map((m) => `${m.sub_name} (in ${m.cat_name})`).join(", ");
        return res.status(409).json({
          error: `Multiple subcategories named "${parsed.subcategory}" exist: ${options}. Say the category too, e.g. "...to ${parsed.subcategory} in ${matches[0].cat_name}".`,
        });
      }

      const [row] = await sql`
        INSERT INTO items (subcategory_id, name, price, description, image_url)
        VALUES (${matches[0].id}, ${parsed.item}, ${parsed.price || ""}, ${parsed.desc || ""}, ${parsed.img || ""})
        RETURNING id, name, price, description AS desc, image_url AS img`;
      return res.json({ applied: parsed, result: row });
    }

    res.status(422).json({ error: "Unsupported action." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Voice command failed." });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Bazar server running on http://localhost:${port}`));
