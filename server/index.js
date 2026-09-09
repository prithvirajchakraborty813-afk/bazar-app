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
