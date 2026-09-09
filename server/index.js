import "dotenv/config";
import express from "express";
import cors from "cors";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const app = express();
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
  const [row] = await sql`
    UPDATE items SET name = ${name}, price = ${price || ""}, description = ${desc || ""}, image_url = ${img || ""}
    WHERE id = ${req.params.id}
    RETURNING id, name, price, description AS desc, image_url AS img`;
  res.json(row);
});

app.delete("/api/items/:id", requireAdmin, async (req, res) => {
  await sql`DELETE FROM items WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

// ---------- Voice command (NVIDIA NIM) ----------
// Admin says something like "add item Alu price 25 to Bazar" (already transcribed to text
// by the browser's own speech recognition — see client code). This sends that text to a
// NIM-hosted LLM, asks it to return a strict JSON action, then applies it to the database.
app.post("/api/voice-command", requireAdmin, async (req, res) => {
  const { transcript } = req.body;
  if (!transcript?.trim()) return res.status(400).json({ error: "No speech text received." });

  try {
    const nimResponse = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.NVIDIA_NIM_MODEL,
        messages: [
          {
            role: "system",
            content:
              'You convert spoken admin commands into strict JSON for a catalog app with Category -> Subcategory -> Item. ' +
              'Reply with ONLY JSON, no prose, no markdown fences. ' +
              'Shape: {"action":"add_item","item":"Alu","price":"25","subcategory":"Bazar","category":"Family","desc":"","img":""} ' +
              'or {"action":"add_category","category":"Family"} ' +
              'or {"action":"add_subcategory","category":"Family","subcategory":"Bazar"} ' +
              'or {"action":"unknown"} if the command does not match a supported action. ' +
              "Price should be digits only, no currency symbol. Infer category/subcategory names from what's spoken even if approximate.",
          },
          { role: "user", content: transcript },
        ],
        temperature: 0,
      }),
    });

    if (!nimResponse.ok) {
      const errText = await nimResponse.text();
      console.error("NIM error:", errText);
      return res.status(502).json({ error: "Voice service unavailable." });
    }

    const nimData = await nimResponse.json();
    const raw = nimData.choices?.[0]?.message?.content?.trim() || "{}";
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
      const [row] = await sql`INSERT INTO categories (name) VALUES (${parsed.category}) RETURNING id, name`;
      return res.json({ applied: parsed, result: row });
    }

    if (parsed.action === "add_subcategory") {
      const [cat] = await sql`SELECT id FROM categories WHERE name ILIKE ${parsed.category} LIMIT 1`;
      if (!cat) return res.status(404).json({ error: `Category "${parsed.category}" not found.` });
      const [row] = await sql`INSERT INTO subcategories (category_id, name) VALUES (${cat.id}, ${parsed.subcategory}) RETURNING id, name`;
      return res.json({ applied: parsed, result: row });
    }

    if (parsed.action === "add_item") {
      const [sub] = await sql`
        SELECT s.id FROM subcategories s
        JOIN categories c ON c.id = s.category_id
        WHERE s.name ILIKE ${parsed.subcategory} AND c.name ILIKE ${parsed.category}
        LIMIT 1`;
      if (!sub) return res.status(404).json({ error: `Subcategory "${parsed.subcategory}" not found under "${parsed.category}".` });
      const [row] = await sql`
        INSERT INTO items (subcategory_id, name, price, description, image_url)
        VALUES (${sub.id}, ${parsed.item}, ${parsed.price || ""}, ${parsed.desc || ""}, ${parsed.img || ""})
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
