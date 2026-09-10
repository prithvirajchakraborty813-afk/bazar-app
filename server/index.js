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
  const nextPrice = price || "";

  const [existing] = await sql`SELECT price FROM items WHERE id = ${req.params.id}`;
  if (existing && existing.price !== nextPrice) {
    await sql`INSERT INTO price_history (item_id, old_price, new_price) VALUES (${req.params.id}, ${existing.price}, ${nextPrice})`;
  }

  const [row] = await sql`
    UPDATE items SET name = ${name}, price = ${nextPrice}, description = ${desc || ""}, image_url = ${img || ""}
    WHERE id = ${req.params.id}
    RETURNING id, name, price, description AS desc, image_url AS img`;
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

// ---------- Status reports (per category / subcategory / global) ----------
// A "report" for any node in the tree (or the whole catalog) covering a
// custom date range: total spend, per-child breakdown, items bought more
// than once (with counts + total spent on that item), and items whose
// price has risen (from price_history), all scoped to that node and
// everything under it.
const parseRange = (req) => {
  const from = req.query.from ? new Date(req.query.from) : new Date(0);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  // include the whole "to" day
  to.setHours(23, 59, 59, 999);
  return { from, to };
};

async function buildReport({ scope, scopeId, from, to }) {
  // Resolve which subcategory ids are in scope.
  let subIds;
  let label = "All categories";
  if (scope === "subcategory") {
    const [sub] = await sql`SELECT id, name FROM subcategories WHERE id = ${scopeId}`;
    if (!sub) return null;
    subIds = [sub.id];
    label = sub.name;
  } else if (scope === "category") {
    const [cat] = await sql`SELECT id, name FROM categories WHERE id = ${scopeId}`;
    if (!cat) return null;
    const subs = await sql`SELECT id FROM subcategories WHERE category_id = ${scopeId}`;
    subIds = subs.map((s) => s.id);
    label = cat.name;
  } else {
    const subs = await sql`SELECT id FROM subcategories`;
    subIds = subs.map((s) => s.id);
  }

  if (subIds.length === 0) {
    return { label, total: 0, count: 0, byChild: [], repeats: [], priceRises: [], from, to };
  }

  const items = await sql`
    SELECT i.id, i.name, i.price, i.created_at, i.subcategory_id,
           s.name AS subcategory, c.id AS category_id, c.name AS category
    FROM items i
    JOIN subcategories s ON s.id = i.subcategory_id
    JOIN categories c ON c.id = s.category_id
    WHERE i.subcategory_id = ANY(${subIds}::int[])
      AND i.created_at >= ${from.toISOString()} AND i.created_at <= ${to.toISOString()}
    ORDER BY i.created_at DESC`;

  const toNum = (p) => Number(String(p || "").replace(/[^0-9.]/g, "")) || 0;
  const total = items.reduce((sum, it) => sum + toNum(it.price), 0);

  // Breakdown by immediate child: subcategories if scope is category/global-per-cat,
  // or categories if scope is global (so the global report shows spend per category).
  const byChildMap = new Map();
  for (const it of items) {
    const key = scope === "global" ? `cat:${it.category_id}` : `sub:${it.subcategory_id}`;
    const name = scope === "global" ? it.category : it.subcategory;
    const entry = byChildMap.get(key) || { name, total: 0, count: 0 };
    entry.total += toNum(it.price);
    entry.count += 1;
    byChildMap.set(key, entry);
  }
  const byChild = [...byChildMap.values()].sort((a, b) => b.total - a.total);

  // Items bought multiple times (grouped by name, case-insensitive).
  const byName = new Map();
  for (const it of items) {
    const key = it.name.trim().toLowerCase();
    const entry = byName.get(key) || { name: it.name, count: 0, total: 0, lastPrice: null, lastDate: null };
    entry.count += 1;
    entry.total += toNum(it.price);
    if (!entry.lastDate || it.created_at > entry.lastDate) {
      entry.lastDate = it.created_at;
      entry.lastPrice = it.price;
    }
    byName.set(key, entry);
  }
  const repeats = [...byName.values()].filter((e) => e.count > 1).sort((a, b) => b.count - a.count);

  // Price rises: from price_history, for items in scope, within range.
  const itemIds = items.map((i) => i.id);
  let priceRises = [];
  if (itemIds.length > 0) {
    const history = await sql`
      SELECT ph.item_id, ph.old_price, ph.new_price, ph.changed_at, i.name
      FROM price_history ph
      JOIN items i ON i.id = ph.item_id
      WHERE i.subcategory_id = ANY(${subIds}::int[])
        AND ph.changed_at >= ${from.toISOString()} AND ph.changed_at <= ${to.toISOString()}
      ORDER BY ph.changed_at DESC`;
    priceRises = history
      .map((h) => ({
        name: h.name,
        from: h.old_price,
        to: h.new_price,
        changedAt: h.changed_at,
        delta: toNum(h.new_price) - toNum(h.old_price),
      }))
      .filter((h) => h.delta > 0);
  }

  return { label, total, count: items.length, byChild, repeats, priceRises, from, to };
}

app.get("/api/report", requireAdmin, async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const report = await buildReport({ scope: "global", scopeId: null, from, to });
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not build report.", detail: err.message });
  }
});

app.get("/api/report/category/:id", requireAdmin, async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const report = await buildReport({ scope: "category", scopeId: req.params.id, from, to });
    if (!report) return res.status(404).json({ error: "Category not found." });
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not build report.", detail: err.message });
  }
});

app.get("/api/report/subcategory/:id", requireAdmin, async (req, res) => {
  try {
    const { from, to } = parseRange(req);
    const report = await buildReport({ scope: "subcategory", scopeId: req.params.id, from, to });
    if (!report) return res.status(404).json({ error: "Subcategory not found." });
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not build report.", detail: err.message });
  }
});

// ---------- Budgets ----------
// scope 'global' has scope_id null; 'category'/'subcategory' reference that id.
// Each budget runs in back-to-back cycles of cycle_days starting at cycle_start,
// auto-renewing forever (no manual reset) — currentCycleStart is computed here.
function currentCycleStart(cycleStartISO, cycleDays) {
  const start = new Date(cycleStartISO);
  const msPerCycle = cycleDays * 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - start.getTime();
  const cyclesPassed = Math.max(0, Math.floor(elapsed / msPerCycle));
  return new Date(start.getTime() + cyclesPassed * msPerCycle);
}

app.get("/api/budgets", requireAdmin, async (req, res) => {
  try {
    const budgets = await sql`SELECT * FROM budgets ORDER BY created_at`;
    const results = [];
    for (const b of budgets) {
      const cycleStart = currentCycleStart(b.cycle_start, b.cycle_days);
      const cycleEnd = new Date(cycleStart.getTime() + b.cycle_days * 24 * 60 * 60 * 1000);
      const report = await buildReport({
        scope: b.scope,
        scopeId: b.scope_id,
        from: cycleStart,
        to: new Date(Math.min(Date.now(), cycleEnd.getTime())),
      });
      results.push({
        id: b.id,
        scope: b.scope,
        scopeId: b.scope_id,
        label: b.label,
        amount: Number(b.amount),
        cycleDays: b.cycle_days,
        cycleStart,
        cycleEnd,
        spent: report ? report.total : 0,
        over: report ? report.total > Number(b.amount) : false,
      });
    }
    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load budgets." });
  }
});

app.post("/api/budgets", requireAdmin, async (req, res) => {
  const { scope, scopeId, label, amount, cycleDays } = req.body;
  if (!["global", "category", "subcategory"].includes(scope)) {
    return res.status(400).json({ error: "Invalid scope." });
  }
  if (!label?.trim() || !amount || !cycleDays) {
    return res.status(400).json({ error: "Label, amount, and cycle length are required." });
  }
  try {
    const [row] = await sql`
      INSERT INTO budgets (scope, scope_id, label, amount, cycle_days)
      VALUES (${scope}, ${scope === "global" ? null : scopeId}, ${label.trim()}, ${amount}, ${cycleDays})
      ON CONFLICT (scope, COALESCE(scope_id, -1))
      DO UPDATE SET label = ${label.trim()}, amount = ${amount}, cycle_days = ${cycleDays}
      RETURNING *`;
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save budget." });
  }
});

app.delete("/api/budgets/:id", requireAdmin, async (req, res) => {
  await sql`DELETE FROM budgets WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

// AI advice for an over-budget scope, via the same Groq LLM used for voice commands.
app.post("/api/budget-advice", requireAdmin, async (req, res) => {
  const { label, amount, spent, cycleDays, topItems } = req.body;
  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content:
              "You are a terse, practical household budgeting assistant. The user has exceeded a spending " +
              "limit. Given the scope name, limit, amount spent, cycle length in days, and top spending " +
              "items, give 2-4 short, concrete, specific suggestions to get back under budget next cycle. " +
              "Plain text, one suggestion per line, no markdown, no headers, no preamble.",
          },
          {
            role: "user",
            content: `Scope: ${label}\nLimit: ${amount} over ${cycleDays} days\nSpent: ${spent}\nTop items: ${JSON.stringify(topItems || [])}`,
          },
        ],
        temperature: 0.4,
      }),
    });
    if (!groqResponse.ok) return res.status(502).json({ error: "Advice service unavailable." });
    const data = await groqResponse.json();
    const advice = data.choices?.[0]?.message?.content?.trim() || "";
    res.json({ advice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not get advice." });
  }
});

// ---------- Offline sync ----------
// Accepts a batch of item-add actions queued while the client was offline
// and applies them in order. Each action: { subcategoryId, name, price, desc, img }.
// Returns per-action results so the client knows what succeeded.
app.post("/api/sync-items", requireAdmin, async (req, res) => {
  const { actions } = req.body;
  if (!Array.isArray(actions)) return res.status(400).json({ error: "actions must be an array." });
  const results = [];
  for (const a of actions) {
    try {
      if (!a.name?.trim() || !a.subcategoryId) {
        results.push({ ok: false, error: "Missing name or subcategory." });
        continue;
      }
      const [row] = await sql`
        INSERT INTO items (subcategory_id, name, price, description, image_url)
        VALUES (${a.subcategoryId}, ${a.name.trim()}, ${a.price || ""}, ${a.desc || ""}, ${a.img || ""})
        RETURNING id, name, price, description AS desc, image_url AS img`;
      results.push({ ok: true, result: row, clientId: a.clientId });
    } catch (err) {
      console.error(err);
      results.push({ ok: false, error: "Insert failed.", clientId: a.clientId });
    }
  }
  res.json({ results });
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
