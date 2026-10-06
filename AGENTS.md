# AGENTS.md

Workspace guidance for ZCode agents working in this repo. A more detailed narrative lives in `CLAUDE.md` and `README.md` — read those before touching sensitive areas (loading overlay, navigation, chat, preserved visuals).

## What this is

SAKANA's personal website, **faithfully ported** from raw HTML/CSS/JS + PHP/MySQL + Node WebSocket to **Vue 3 + TypeScript SPA + Node/Express + MySQL + ws**. Sections: home, online chat, question bank, dev log, blog, login/signup.

**Governing constraint:** preserve all original observable behavior and visuals — copy, animations, interaction details, timings (see README's enumerated list). Match surrounding style; do not alter preserved behaviors unless explicitly asked. A few deliberate deviations are documented in README (correct `bcrypt.compare`, parameterized SQL, `messages.is_displayed` default 1, config externalized to `.env`).

## Layout

```
package.json        # npm workspaces root; concurrently runs client + server
client/             # Vue 3 + TS + Vite + Vue Router SPA (ESM)
server/             # Node + Express + mysql2 + ws, runs TS directly via tsx (ESM, no compile step)
deploy/             # bash deploy script + PM2 ecosystem + remote-setup
devlogs/ logs/      # gitignored local-only notes
```

## Commands (run from repo root)

```bash
npm install            # installs both workspaces (install at root so workspaces link)
npm run dev            # concurrently: Vite (5173) + Express/WS (3000, ws 9000)
npm run dev:client     # Vite only
npm run dev:server     # tsx watch, Express + WS only
npm run build          # client only: vue-tsc --noEmit (the only typecheck) && vite build → client/dist
npm start              # server only: tsx src/index.ts (serves client/dist in prod)
npm run deploy         # bash deploy/deploy.sh (needs deploy/.deploy.env)
```

**No test framework, no linter.** The only typecheck is `vue-tsc --noEmit` inside `npm run build` (client). The server has no typecheck step.

## Dev runtime

Three services: Vite (5173, **`base: '/web/'`** so dev URL is `http://localhost:5173/web/`, proxies `/api` → Express 3000), Express (3000), WebSocket chat (9000, started by Express via `startChatServer()`).

Production serves under nginx subpath `/web/` (nginx strips the prefix before proxying to Node). `client/.env.production` sets `VITE_API_BASE=/web/api` and `VITE_WS_URL=wss://...`; `server/.env` sets `WS_USE_SSL=true` + cert paths for `wss`.

## Client rules

- **Vue 3 + TS + Vite + Vue Router.** All views lazy-loaded except `TitleCardView` (eager). Unknown paths redirect to `/`.
- **No Pinia.** "Stores" under `client/src/stores/` are plain reactive modules exposing shared `ref`s via composable-style functions (`useLoading`, `useAuth`). Auth state = username in `localStorage`; real auth = server-side session cookie.
- **Loading overlay mechanic (do not break timings).** `LOADING_COVER_MS = 600` (in `stores/loading.ts`). `covered` starts `true`; `App.vue` reveals on mount; router `beforeEach` calls `cover()` then waits 600ms before resolving (skipped on first nav and same-path); `afterEach` reveals. `goExternal(url)` covers 600ms before `window.location.href`. The overlay was redone as a **four-color-block** left-in/right-out animation; keep the cadence unified.
- **Title card (`/welcome`):** shown once per session on first entry to `/` (guarded by `sessionStorage['titleCardSeen']`). On that first visit the loading overlay is **hidden entirely** (`hidden=true`) to avoid first-paint flicker; `cover()` clears that flag so subsequent transitions animate normally.
- **Styles** are global CSS files imported in **both** `main.ts` and `App.vue` (redundant by design — keep both in sync). Page CSS is isolated by page-wrapper class prefix, **not** `<style scoped>`. Follow the prefix convention for new pages.
- Data access via `composables/useApi.ts` (fetch wrappers), `composables/useWebSocket.ts` (chat), `composables/useBlogPosts.ts` + `useMarkdown.ts` (blog, uses `marked`), `useAshParticles.ts`, `useCopyText.ts`.

## Server rules

- **Express + mysql2/promise pool + express-session + bcryptjs + ws.** Entry `src/index.ts` mounts routers under `/api`, configures sessions, and in prod statically serves `client/dist` with SPA fallback (`GET *` → `index.html` unless path starts with `/api`).
- **Import paths use `.js` extensions** even though sources are `.ts` (ESM + Bundler resolution). Add modules as Express `Router`s in `src/routes/`.
- **DB:** shared `mysql2/promise` pool in `src/db.ts`, creds from `.env` (never hardcoded). Always **parameterized queries** (`pool.query(sql, [params])`).
- **Schema** (`server/src/schema.sql`, 5 tables): `messages`, `devLog`, `users`, `logs`, `blog_posts`. Seed blog content via `server/src/seed_blog.sql`.
- API surface (mirrors old PHP):
  - `GET/POST /api/messages` — board. GET filters `is_displayed = 1`, orders `id DESC`. **Do not write `is_displayed` on insert** — it relies on the column default 1 or messages won't display.
  - `GET/POST /api/devlog` — POST writes only `change_description` (timestamp is DB-generated).
  - `GET /api/blog` — published posts (`is_published = 1`) ordered by `date DESC`. Field aliases must match frontend `BlogPost` types verbatim (`read_time AS readTime`). Blog **detail/body** is rendered client-side from Markdown under `client/src/content/posts` (`.md` files), not from the DB.
  - `POST /api/auth/signup|login` — `bcrypt.hash` (salt 10) / `bcrypt.compare`. `ER_DUP_ENTRY` → 400. On success set `req.session.username`.
- **WebSocket chat** (`src/ws/chatServer.ts`): separate `ws` server on its own port (9000 / `wss`+SSL), independent of Express. Preserve: clients keyed by IP (same IP overwrites), broadcast `<ip>: <message>` to everyone *except* sender, log connect/disconnect/message to `logs`.

## Cross-cutting

- Three client↔server channels stay distinct: REST `/api/*` (same-origin via Vite proxy in dev, direct in prod), WebSocket (separate port, URL from `VITE_WS_URL`), and the session cookie (auth lives in the cookie, not a client-sent token).
- `deploy/.deploy.env` (gitignored) holds SSH host/user/dir/PM2 app; deploy script strips CRLF from those values to survive Windows editing.
- `.env`, certs (`*.pem`/`*.key`, `server/certs/`), `logs/`, `devlogs/`, and `deploy/.deploy.env` are gitignored — never commit secrets.
