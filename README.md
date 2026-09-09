# Bazar catalog app — Neon + Groq voice admin

Two roles: General (browse only) and Admin (add/edit/delete + voice commands).
Data lives in Neon Postgres. Categories are always added manually in the
admin panel. Admin can speak commands for the two levels below that and
Groq turns them into a database update:
- Add a subcategory: "add subcategory electricity under family"
- Add an item: "add item rice price 30 to bazar" (no need to say the
  category — just the subcategory is enough, unless two categories both
  have a subcategory with that name)

## 1. Set up Neon

1. Go to https://neon.tech, sign up free, create a project.
2. Copy the connection string from the dashboard (starts with `postgresql://`).
3. Open the Neon SQL Editor and run everything in `server/schema.sql`.
   If you already created the first version of the app, run the updated file
   again: its `IF NOT EXISTS` statements retain your catalog and add the
   `price_history` and `budgets` tables.

## 2. Get a Groq API key

1. Go to https://console.groq.com/keys, sign in (email or Google, no card), generate an API key.
2. That's it — no separate key needed for transcription vs. command parsing, Groq handles both.

## 3. Configure the server

```
cd server
npm install
cp .env.example .env
```

Edit `.env` and fill in:
- `DATABASE_URL` — your Neon connection string
- `ADMIN_PASSWORD` — pick your own admin password
- `GROQ_API_KEY` — your Groq key

Optional: load starter data (Family/Bazar/Chal/Dal/Alu example):

```
npm run seed
```

Start the server:

```
npm start
```

You should see: `Bazar server running on http://localhost:3001`

## 4. Run the frontend

The `client/` folder is already a complete Vite project. In a new terminal:

```
cd client
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

For local development, copy `client/.env.example` to `client/.env` first. For
a deployment, set `VITE_API_URL` to the deployed server URL plus `/api` before
building the frontend.

## 5. Using it

- Log in as **general** to browse (read-only).
- Log in as **admin** with the password you set in `.env`.
- In the admin panel, use "Add category" / "Add sub" / "Add item" forms, or
  click **Speak a command**, allow microphone access, say something like
  *"add subcategory electricity under family"* or *"add item rice price 30
  to bazar"*, then click **Stop recording**.
- Voice input records real audio and sends it to Groq's hosted
  `whisper-large-v3-turbo` model for transcription, then the transcript is
  sent to Groq's `openai/gpt-oss-120b` to turn it into a structured
  action, which gets applied to Neon. Adding a brand-new top-level category
  is manual-only (use the "Add category" box) — voice only handles
  subcategories and items.
- The admin panel also shows a **spending summary** above the voice panel:
  totals for today, this month, and the last 3 months, based on the price
  of each item on the day it was added, plus two expandable views —
  a per-day breakdown for the last 30 days, and a date/time log of every
  item added, with a range selector (30 days / 3 / 6 months / 1 year /
  all time) and a "Load more" button so nothing older is ever cut off.
- The **Reports** tab has custom start/end dates and drill-down reports for
  all spending, every category, and every subcategory. It highlights items
  bought repeatedly and price rises both between repeated purchases and after
  an item price edit.
- The **Budgets** tab accepts a global, category, or subcategory cap. Choose
  any 1–365 day recurring cycle with the slider (for example 12 or 34 days),
  and the app shows an over-limit alert plus practical AI suggestions. If a
  Groq key is unavailable, it safely falls back to local suggestions.
- The client is installable as a PWA. After it has been opened once online,
  the catalog and app shell are available offline. New or edited items made
  offline are stored only on that device and sync automatically after the
  admin signs in and reconnects. Categories and subcategories still need a
  connection because the server must issue their IDs.

## Notes

- The admin password is sent with each write request as a header — fine for
  a small personal project, but for anything public-facing you'd want real
  sessions/JWT auth instead.
- CORS is wide open (`cors()` with no options) for local development. Lock
  this down before deploying publicly.
- If voice commands don't match ("Subcategory not found"), it's usually
  because the LLM guessed a slightly different category/subcategory name
  than what's in your database — try being explicit, e.g. "add item X
  price Y to [exact subcategory]".
- If two different categories both have a subcategory with the same name
  (e.g. two "Bazar" subcategories), an item command that only names the
  subcategory will come back asking you to also say the category — e.g.
  "add item rice price 30 to bazar in family".
- Groq's free tier (no credit card) covers ~2,000 requests/day and 14,400
  LLM requests/day — plenty for admin use.
