# Deploying Blobbie Dash

Blobbie Dash has two parts:

1. **The game (frontend)** — pure static files in `public/` (HTML/CSS/JS canvas).
   Solo play, all customization, sound and the whole 3D-style world run 100% in the
   browser with **no backend**.
2. **The realtime backend** (`server/`) — Node + Express + **Socket.IO** + SQLite.
   This powers the **online** features: ranked PvP matchmaking, 4-player friend
   rooms, the leaderboard, weekly tournaments and the $BLOBBIE wallet.

> The client degrades gracefully: with no backend reachable it auto-creates a local
> guest profile so **Solo play + customization work**, and the online modes show a
> friendly "needs the game server" message.

---

## A) Vercel — static frontend (solo + customization)

Vercel is a great host for the **frontend**. Note: Vercel's serverless model does
**not** run a persistent Socket.IO/WebSocket server or a persistent SQLite file, so
the **online multiplayer/leaderboard features won't run on Vercel** — use a Node host
for those (section B). Solo + all theming work perfectly on Vercel.

### Steps (Git import — easiest)
1. Push this repo to GitHub/GitLab/Bitbucket.
2. Go to <https://vercel.com/new> and **Import** the repo.
3. Framework Preset: **Other**. Leave Build Command empty. (This repo includes a
   `vercel.json` that serves the `public/` folder as the site root, so no extra
   config is needed.)
4. Click **Deploy**. Your game is live at `https://<project>.vercel.app`.

### Steps (Vercel CLI)
```bash
npm i -g vercel
vercel        # follow prompts (first deploy = preview)
vercel --prod # production deploy
```

### Alternative (no vercel.json)
If you prefer, delete `vercel.json` and in **Project → Settings → General** set
**Root Directory = `public`**. Vercel then serves `public/` as the site.

---

## B) Full game with multiplayer — a Node host

Use any host that runs a long-lived Node process with WebSockets (Render, Railway,
Fly.io, a VPS, etc.). The server serves the frontend **and** the realtime API on one
port, so everything (solo + online) works.

Common settings:
- **Install command:** `npm install` (builds the native `better-sqlite3`)
- **Start command:** `npm start`
- **Port:** the app reads `process.env.PORT` (hosts set this automatically).
- **Persistent disk (optional):** the SQLite DB is written to `data/blobbie.db`.
  Mount a persistent volume at `data/` if you want scores/wallets to survive restarts.

### Render (example)
1. New → **Web Service** → connect the repo.
2. Runtime **Node**, Build `npm install`, Start `npm start`.
3. (Optional) add a **Disk** mounted at `/opt/render/project/src/data`.
4. Deploy → open the URL. Multiplayer + leaderboard now work.

### Railway / Fly.io
- **Railway:** New Project → Deploy from repo → it auto-detects Node, runs
  `npm install` / `npm start`. Add a volume at `/app/data` to persist the DB.
- **Fly.io:** `fly launch` (Node), set the internal port to your `PORT`, `fly deploy`.
  Add a volume mounted at `/app/data` for persistence.

---

## C) Run locally
```bash
npm install
npm start          # http://localhost:3000  (PORT env to override)
```

---

## D) Hybrid (static frontend on Vercel + server elsewhere)
The client talks to its **own origin** for the API and Socket.IO. The simplest way
to get full multiplayer is to host the whole app (section B) and point players there.
If you specifically want the frontend on Vercel and the realtime server on another
host, you'd serve the same `public/` from that Node host too (it already does), and
just share that host's URL — no code changes needed.
