# Bazar catalog app — Neon + NVIDIA NIM voice admin

Two roles: General (browse only) and Admin (add/edit/delete + voice commands).
Data lives in Neon Postgres. Admin can speak commands like
"add item Alu price 25 to Bazar in Family" and NVIDIA NIM turns that into a
database update.

## 1. Set up Neon

1. Go to https://neon.tech, sign up free, create a project.
2. Copy the connection string from the dashboard (starts with `postgresql://`).
3. Open the Neon SQL Editor and run everything in `server/schema.sql`.

## 2. Get an NVIDIA NIM key

1. Go to https://build.nvidia.com, sign in, generate an API key.
2. Note the model name you want (default here: `meta/llama-3.1-70b-instruct`).

## 3. Configure the server

```
cd server
npm install
cp .env.example .env
```

Edit `.env` and fill in:
- `DATABASE_URL` — your Neon connection string
- `ADMIN_PASSWORD` — pick your own admin password
- `NVIDIA_NIM_API_KEY` — your NIM key
- `NVIDIA_NIM_MODEL` — leave as default or change

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

## 5. Using it

- Log in as **general** to browse (read-only).
- Log in as **admin** with the password you set in `.env`.
- In the admin panel, use "Add category" / "Add sub" / "Add item" forms, or
  click **Speak a command**, allow microphone access, say something like
  *"add item Alu price 25 to Bazar in Family"*, then click **Stop recording**.
- Voice input records real audio and sends it to NVIDIA's hosted
  `nvidia/nemotron-asr-streaming` model for transcription, then the
  transcript is sent to your text model to turn it into a structured
  action, which gets applied to Neon.

## Notes

- The admin password is sent with each write request as a header — fine for
  a small personal project, but for anything public-facing you'd want real
  sessions/JWT auth instead.
- CORS is wide open (`cors()` with no options) for local development. Lock
  this down before deploying publicly.
- If voice commands don't match ("Subcategory not found"), it's usually
  because NIM guessed a slightly different category/subcategory name than
  what's in your database — try being explicit: "add item X price Y to
  [exact subcategory] in [exact category]".
