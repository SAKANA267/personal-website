# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

A **faithful port** of an older site (`nihonggo_web_learning`) from "raw HTML/CSS/JS + PHP/MySQL + Node WebSocket" to "Vue 3 + TypeScript SPA + Node/Express + MySQL + ws". Despite the legacy directory name, this is SAKANA's personal website (home / online chat / question bank / dev log / blog / share / login+signup) — it contains **no** Japanese-learning content.

The guiding constraint of this codebase: **preserve all original observable behavior and visuals** — copy, animations, interaction details, timings. The README enumerates the exact details to keep (600ms four-color-block loading transition, ash particles, copy tooltip, chat Blob parsing + `': '` split, quiz red/green feedback + localStorage, staggered message/log fade-in, footer & rainbow signature). When adding or changing features, match the surrounding style and do not alter these preserved behaviors unless explicitly asked.

A few deliberate deviations from the original were already made (documented in README): correct `bcrypt.compare` login, parameterized SQL queries, `messages.is_displayed` defaulting to 1, and config externalized to `.env`.

## Commands

This is an **npm workspaces** monorepo; run commands from the repo root.

```bash
npm install              # installs both client and server workspaces

npm run dev              # concurrently starts BOTH (the normal dev loop)
npm run dev:client       # Vite dev server only  → http://localhost:5173/web/
npm run dev:server       # tsx watch (Express + WS) only → http://localhost:3000, ws://localhost:9000

npm run build            # client only: vue-tsc --noEmit (typecheck) && vite build → client/dist
npm start                # server only: tsx src/index.ts (serves client/dist in prod)
npm run preview -w client# preview the built client
```

Dev runs **three services**: Vite (5173, proxies `/api` → Express 3000), Express (3000), and the WebSocket chat server (9000). `npm run dev` starts client + server; the WS server is started by the Express process via `startChatServer()`.

**No test framework or linter is configured** — there are no test/lint scripts. Typechecking the client is done by `npm run build` (`vue-tsc --noEmit`); the server has no separate typecheck step.

### First-time setup
1. Create a MySQL database and import `server/src/schema.sql` (9 tables: `messages`, `devLog`, `users`, `logs`, `blog_posts`, `post_comments`, `post_likes`, `blog_images`, `share_items`).
2. Copy `server/.env.example` → `server/.env` (DB creds, `PORT`, `SESSION_SECRET` (refuses to start in prod without it), `ADMIN_USERNAMES`, `SHARE_MAX_MB`, `BLOG_IMAGE_MAX_MB`, `WS_PORT`, and prod `WS_USE_SSL` + cert paths).
3. Copy `client/.env.example` → `client/.env` (`VITE_API_BASE=/api`, `VITE_WS_URL=ws://localhost:9000`). For production, `client/.env.production` points `VITE_WS_URL` at `wss://...` and `server/.env` sets `WS_USE_SSL=true` with cert paths.

## Architecture

### Client (`client/`, ESM, `type: module`)
- **Vue 3 + TS + Vite + Vue Router** SPA. All views are lazy-loaded chunks (`client/src/router/index.ts`); unknown paths redirect to `/`.
- **No Pinia.** "Stores" are plain reactive modules under `client/src/stores/` exposing shared `ref`s via composable-style functions (`useLoading`, `useAuth`, `useLocale`). Auth = server-side session cookie as source of truth + `localStorage` as first-paint cache; `useAuth()` exposes `username`, `isAdmin`, `restored`. `App.vue` calls `initAuth()` on mount (reconciles the cache against `GET /api/auth/me`, clears on 401).
- **Loading overlay mechanic** spans three files: `covered` starts `true` (so the overlay covers first paint); `App.vue` calls `loading.reveal()` on mount; the router's `beforeEach` calls `loading.cover()` and waits **`LOADING_COVER_MS` (600ms)** before resolving (skipped on the very first navigation and same-path navigations), `afterEach` reveals. `goExternal(url)` (`stores/loading.ts`) also covers for 600ms before `window.location.href` redirect. The overlay is a four-color-block left-in/right-out animation (redone from the original gray spinner). If you touch navigation or the overlay, preserve this timing.
- **Styles** are global CSS files imported in **both** `main.ts` and `App.vue` (redundant by design — keep both in sync). Each page's CSS is isolated by a page-wrapper class prefix rather than scoped style blocks; when adding page styles, follow the same prefix-isolation convention rather than using `<style scoped>`.
- Data access goes through `composables/useApi.ts` (thin `fetch` wrappers — the old PHP endpoints plus the login/blog/share/admin additions), `composables/useWebSocket.ts` (chat client), `useBlogPosts.ts` + `useMarkdown.ts` (blog, `marked` + DOMPurify), `useAdminApi.ts` (admin panel), `useAshParticles.ts`, `useCopyText.ts`, and `useScreenBroadcast.ts` (WebRTC screen broadcast).

### Server (`server/`, ESM, `type: module`, runs TS directly via `tsx` — **no compile step**)
- **Express + mysql2 (promise pool) + express-session (MySQL store on the shared pool) + bcryptjs + ws.** Entry: `src/index.ts` mounts the `/api/messages`, `/api/devlog`, `/api/auth`, `/api/blog`, `/api/share` and `/api/admin` routers (plus a `/api/health` probe), configures sessions, then in production statically serves `client/dist` with an SPA fallback (`GET *` returns `index.html` unless the path starts with `/api`).
- **Import paths use `.js` extensions** even though sources are `.ts` (ESM + Bundler resolution). When adding modules, import from `'./foo.js'` and define route modules as Express `Router`s in `src/routes/`.
- **DB**: shared `mysql2/promise` pool in `src/db.ts` (creds from `.env`, never hardcoded). Always use **parameterized queries** (`pool.query(sql, [params])`) — this was a deliberate fix over the original string-concatenation PHP.
- **API surface** (old PHP endpoints + login/blog/share/admin additions; REST errors are machine codes `{ error: 'CODE' }`, not prose):
  - `GET/POST /api/messages` — board; GET filters `is_displayed = 1`, orders by `id DESC`, takes `?limit` (1–1000, default 500; admins see all rows incl. `id`/`is_displayed`); POST inserts with `NOW()` and relies on the column default of 1 for `is_displayed` (do **not** write that column on insert, or messages won't display). `PATCH /api/messages/:id` (`{is_displayed: 0|1}`) is admin-only moderation.
  - `GET/POST /api/devlog` — dev log; GET takes the same `?limit`; POST writes only `change_description` (timestamp is DB-generated) and is admin-only (401 not logged in / 403 not whitelisted).
  - `POST /api/auth/signup`, `POST /api/auth/login` — `bcrypt.hash` on signup (salt rounds 10), `bcrypt.compare` on login (the original used plaintext compare and was broken). `ER_DUP_ENTRY` → 400 `{ error: 'AUTH_USERNAME_EXISTS' }`. On success, login regenerates the session, sets `req.session.username` and responds `{username, isAdmin}`. Plus `GET /api/auth/me` (session check), `POST /api/auth/logout`, `POST /api/auth/change-password`, `POST /api/auth/ws-token` (one-time WS handshake token), `POST /api/auth/admin/reset-password` (admin-only, cannot reset self).
  - `GET/POST /api/blog`, `GET/PUT/DELETE /api/blog/:id`, `GET/POST /api/blog/:slug/comments`, `GET/POST /api/blog/:slug/likes` — user-authored posts (slug namespaced `u-*`), slug-keyed comments/likes (static `.md` posts get them too); author-or-admin on writes, drafts author-visible only. Compose-side extras: `POST /api/blog/images` (login, multipart, rate-limited; magic-byte sniff + mime/extension whitelist, SVG rejected, `BLOG_IMAGE_MAX_MB` default 8, per-user quota 500, files in `server/uploads/blog`, tracked in `blog_images`). Each upload also gets a **WebP display variant** via `sharp` (≤1600×4000, q82; skipped for small/unsrinkable images; failures fall back to original-only): `GET /api/blog/images/:name` serves the variant, `…/original` the original, `…/meta` `{origSize, dispSize}`. The compose page inserts `![caption](url)` and renders standalone images as `<figure>` + `<figcaption>`, with `enhanceBlogImages()` adding a size badge + 查看原图 link on the reading page; the 导入 .md button is a client-side-only import (no server round trip). Admin cleanup `POST /api/admin/images/cleanup` purges unreferenced images (both files).
  - `POST /api/share/text|file`, `GET /api/share/:code` (+ `/file`, `/download`) — QR-code share (text/image/file with expiry + pickup code); `GET /api/share/mine` and `DELETE /api/share/:code` (owner or admin) are the login-adapted endpoints.
- **WebSocket chat** (`src/ws/chatServer.ts`) is a **separate `ws` server** on its own port (9000 dev / `wss`+SSL in prod), independent from Express. Logged-in users connect with `?token=` (one-time token from `POST /api/auth/ws-token`) and are shown/keyed as `@username`; guests stay IP-keyed (same IP overwrites the previous connection). Broadcasts `<display>: <message>` to everyone *except* the sender, and logs connect/disconnect/message events to the `logs` table (sender = username or IP). WebRTC screen-broadcast signaling rides the same server via `RTC:`-prefixed frames (single live room, first-come-first-served; not broadcast, not logged).

### Cross-cutting notes
- The **server** and **client** communicate three ways: REST (`/api/*`, same-origin via Vite proxy in dev, direct in prod), WebSocket (separate port, URL from `VITE_WS_URL`), and the session cookie (login). Keep these three channels distinct — auth lives in the cookie, not a token the client sends.
- `mysql2`, `express`, `vue`, etc. are listed in the respective workspace `package.json` files; install at the **root** so npm workspaces links them correctly.
- The repo is a single git history ("Initial commit: Vue 3 + TypeScript 全栈个人网站"). `devlogs/` and `logs/` are gitignored local-only notes.
