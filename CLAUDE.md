# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

A **faithful port** of an older site (`nihonggo_web_learning`) from "raw HTML/CSS/JS + PHP/MySQL + Node WebSocket" to "Vue 3 + TypeScript SPA + Node/Express + MySQL + ws". Despite the legacy directory name, this is SAKANA's personal website (home / online chat / question bank / dev log / login+signup) — it contains **no** Japanese-learning content.

The guiding constraint of this codebase: **preserve all original observable behavior and visuals** — copy, animations, interaction details, timings. The README enumerates the exact details to keep (1000ms loading transition, ash particles, copy tooltip, chat Blob parsing + `': '` split, quiz red/green feedback + localStorage, staggered message/log fade-in, footer & rainbow signature). When adding or changing features, match the surrounding style and do not alter these preserved behaviors unless explicitly asked.

A few deliberate deviations from the original were already made (documented in README): correct `bcrypt.compare` login, parameterized SQL queries, `messages.is_displayed` defaulting to 1, and config externalized to `.env`.

## Commands

This is an **npm workspaces** monorepo; run commands from the repo root.

```bash
npm install              # installs both client and server workspaces

npm run dev              # concurrently starts BOTH (the normal dev loop)
npm run dev:client       # Vite dev server only  → http://localhost:5173
npm run dev:server       # tsx watch (Express + WS) only → http://localhost:3000, ws://localhost:9000

npm run build            # client only: vue-tsc --noEmit (typecheck) && vite build → client/dist
npm start                # server only: tsx src/index.ts (serves client/dist in prod)
npm run preview -w client# preview the built client
```

Dev runs **three services**: Vite (5173, proxies `/api` → Express 3000), Express (3000), and the WebSocket chat server (9000). `npm run dev` starts client + server; the WS server is started by the Express process via `startChatServer()`.

**No test framework or linter is configured** — there are no test/lint scripts. Typechecking the client is done by `npm run build` (`vue-tsc --noEmit`); the server has no separate typecheck step.

### First-time setup
1. Create a MySQL database and import `server/src/schema.sql` (4 tables: `messages`, `devLog`, `users`, `logs`).
2. Copy `server/.env.example` → `server/.env` (DB creds, `PORT`, `SESSION_SECRET`, `WS_PORT`, and prod `WS_USE_SSL` + cert paths).
3. Copy `client/.env.example` → `client/.env` (`VITE_API_BASE=/api`, `VITE_WS_URL=ws://localhost:9000`). For production, `client/.env.production` points `VITE_WS_URL` at `wss://...` and `server/.env` sets `WS_USE_SSL=true` with cert paths.

## Architecture

### Client (`client/`, ESM, `type: module`)
- **Vue 3 + TS + Vite + Vue Router** SPA. All views are lazy-loaded chunks (`client/src/router/index.ts`); unknown paths redirect to `/`.
- **No Pinia.** "Stores" are plain reactive modules under `client/src/stores/` exposing shared `ref`s via composable-style functions (`useLoading`, `useAuth`). Auth state is just the username persisted to `localStorage` — the real auth state is the server-side session cookie.
- **Loading overlay mechanic** spans three files and replicates the original 1000ms transition: `covered` starts `true` (so the overlay covers first paint); `App.vue` calls `loading.reveal()` on mount; the router's `beforeEach` calls `loading.cover()` and waits **1000ms** before resolving (skipped on the very first navigation and same-path navigations), `afterEach` reveals. `goExternal(url)` (`stores/loading.ts`) also covers for 1s before `window.location.href` redirect. If you touch navigation or the overlay, preserve this timing.
- **Styles** are global CSS files imported in **both** `main.ts` and `App.vue` (redundant by design — keep both in sync). Each page's CSS is isolated by a page-wrapper class prefix rather than scoped style blocks; when adding page styles, follow the same prefix-isolation convention rather than using `<style scoped>`.
- Data access goes through `composables/useApi.ts` (thin `fetch` wrappers mirroring the original PHP endpoints) and `composables/useWebSocket.ts` (chat client).

### Server (`server/`, ESM, `type: module`, runs TS directly via `tsx` — **no compile step**)
- **Express + mysql2 (promise pool) + express-session + bcryptjs + ws.** Entry: `src/index.ts` mounts `/api/messages`, `/api/devlog`, `/api/auth` routers, configures sessions, then in production statically serves `client/dist` with an SPA fallback (`GET *` returns `index.html` unless the path starts with `/api`).
- **Import paths use `.js` extensions** even though sources are `.ts` (ESM + Bundler resolution). When adding modules, import from `'./foo.js'` and define route modules as Express `Router`s in `src/routes/`.
- **DB**: shared `mysql2/promise` pool in `src/db.ts` (creds from `.env`, never hardcoded). Always use **parameterized queries** (`pool.query(sql, [params])`) — this was a deliberate fix over the original string-concatenation PHP.
- **API surface** (mirrors the old PHP files):
  - `GET/POST /api/messages` — board; GET filters `is_displayed = 1` and orders by `id DESC`; POST inserts with `NOW()` and relies on the column default of 1 for `is_displayed` (do **not** write that column on insert, or messages won't display).
  - `GET/POST /api/devlog` — dev log; POST writes only `change_description` (timestamp is DB-generated).
  - `POST /api/auth/signup`, `POST /api/auth/login` — `bcrypt.hash` on signup (salt rounds 10), `bcrypt.compare` on login (the original used plaintext compare and was broken). `ER_DUP_ENTRY` → 400 "Username already exists". On success, login sets `req.session.username` and returns the username.
- **WebSocket chat** (`src/ws/chatServer.ts`) is a **separate `ws` server** on its own port (9000 dev / `wss`+SSL in prod), independent from Express. Original behaviors preserved: clients keyed by IP (same IP overwrites the previous connection), broadcasts `<ip>: <message>` to everyone *except* the sender, and logs connect/disconnect/message events to the `logs` table.

### Cross-cutting notes
- The **server** and **client** communicate three ways: REST (`/api/*`, same-origin via Vite proxy in dev, direct in prod), WebSocket (separate port, URL from `VITE_WS_URL`), and the session cookie (login). Keep these three channels distinct — auth lives in the cookie, not a token the client sends.
- `mysql2`, `express`, `vue`, etc. are listed in the respective workspace `package.json` files; install at the **root** so npm workspaces links them correctly.
- The repo is a single git history ("Initial commit: Vue 3 + TypeScript 全栈个人网站"). `devlogs/` and `logs/` are gitignored local-only notes.
