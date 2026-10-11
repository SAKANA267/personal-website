# AGENTS.md

Workspace guidance for ZCode agents working in this repo. A more detailed narrative lives in `CLAUDE.md` and `README.md` — read those before touching sensitive areas (loading overlay, navigation, chat, preserved visuals).

## What this is

SAKANA's personal website, **faithfully ported** from raw HTML/CSS/JS + PHP/MySQL + Node WebSocket to **Vue 3 + TypeScript SPA + Node/Express + MySQL + ws**. Sections: home, online chat, question bank, dev log, blog, share, login/signup.

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

- **Vue 3 + TS + Vite + Vue Router.** All views lazy-loaded (`() => import(...)` in `router/index.ts`); the title card is `TitleCardHero.vue`, a component inside `HomeView` (no dedicated route). Unknown paths redirect to `/`.
- **No Pinia.** "Stores" under `client/src/stores/` are plain reactive modules exposing shared `ref`s via composable-style functions (`useLoading`, `useAuth`). Auth = server-side session cookie as source of truth + `localStorage` as first-paint cache; `useAuth()` exposes `username`, `isAdmin`, `restored`. `App.vue` calls `initAuth()` on mount (reconciles cache against `GET /api/auth/me`, clears on 401). Router guards (declared after the cover guard): logged-in → `/login`/`/signup` redirect to `/`; `/account` and `/blog/compose` require login. `/account` view = change password + logout (+ admin-only reset-password tool).
- **Corner nav replaces the old per-page TopNav (deleted).** `CornerNav.vue` renders at App level (outside `RouterView` — fixed positioning must not sit inside animated page wrappers): top-left home-house icon (hidden on `/`), top-right `AccountMenu.vue` icon (hidden on `/` while the title card is up) plus a `.corner-lang` zh/en toggle to its left (same visibility rule). Guests click the account icon → `/login`; logged-in users get a dropdown (账号主页 / 退出登录) with the trigger inverted to an ink block. Styles are global (un-prefixed `.account-entry*` / `.corner-nav-home` / `.corner-lang` in `global.css` §12, z-index 100).
- **i18n (zh default / en):** hand-rolled, zero new deps — `stores/locale.ts` (plain reactive module like the other stores) exposes `t(key, vars)` / `setLocale` / `apiError(data, fallbackKey)` via `useLocale()`. Packs live in `client/src/locales/{zh,en}.ts`; zh is bundled (and is the TS schema — `MessagePack`/`MessageKey` make every `t()` call typechecked, missing keys fail `vue-tsc`); en lazy-loads as its own chunk. Switching is purely reactive (no reload, no loading-cover involvement); choice persists in `localStorage['locale']` and mirrors `<html lang>`; on cold boot a non-default locale rehydrates its pack (renders zh for the first frames). zh pack preserves the site's copy verbatim (mixed EN/CN headers are the original design). Blog .md content, DB posts, comments, share titles and the ChartsLab case cards are content and stay untranslated; CSS must not hardcode copy in `content:` — use `content: attr(data-*)` fed from `t()` (see `.lab-prompt`).
- **Loading overlay mechanic (do not break timings).** `LOADING_COVER_MS = 600` (in `stores/loading.ts`). `covered` starts `true`; `App.vue` reveals on mount; router `beforeEach` calls `cover()` then waits 600ms before resolving (skipped on first nav and same-path); `afterEach` reveals. `goExternal(url)` covers 600ms before `window.location.href`. The overlay was redone as a **four-color-block** left-in/right-out animation; keep the cadence unified.
- **Title card (HomeView hero):** shown once per session on first entry to `/` (guarded by `sessionStorage['titleCardSeen']`). On that first visit the loading overlay is **hidden entirely** (`hidden=true`) to avoid first-paint flicker; `cover()` clears that flag so subsequent transitions animate normally.
- **Styles** are global CSS files imported in **both** `main.ts` and `App.vue` (redundant by design — keep both in sync). Page CSS is isolated by page-wrapper class prefix, **not** `<style scoped>`. Follow the prefix convention for new pages.
- **Responsive pattern (all pages, desktop-first, layout-preserving).** Baseline lives in `design-system.css` §7 "响应式基线"; per-page overrides sit in each page CSS's `响应式设计` section. Rules:
  1. **Breakpoints: 1024 / 768 / 480 px**, max-width queries in that order. 1024 = wide furniture退场 (e.g. blog TOC hidden); 768 = tablet single-column, `--container-padding` steps 24→16; 480 = phone compact, padding 16→12. Don't invent new breakpoints.
  2. **No horizontal page overflow, ever** — fix the root cause, never `overflow-x: hidden` on body. The global baseline guarantees: `img/svg/video/canvas/iframe { max-width: 100% }`, `textarea { max-width: 100% }`, and `:not(pre) > code|kbd|samp { overflow-wrap: anywhere }` (inline code like `` `{...}` `` tokens may wrap; `pre > code` keeps horizontal scrolling).
  3. **Wide content scrolls inside its own box, it never stretches the page.** Template-owned tables/wide blocks get wrapped in the shared `.table-scroll` utility (`overflow-x: auto`; used by DevLog's `#userTable` — its ≤480px `min-width: 500px` depends on this wrapper). v-html markdown tables can't be wrapped, so `.markdown-body table { display: block; overflow-x: auto }` at ≤768 (both blog-detail and compose-preview scopes). Fenced code blocks scroll via `pre { overflow-x: auto }`.
  4. **Flow first: flex rows that can collide get `flex-wrap: wrap`** (`.compose-actions`, meta strips already do); grids use `auto-fit` + `minmax()` or collapse to `1fr` at 768.
  5. **Fluid heights use `dvh` with a `vh` fallback** (`height: 100vh; height: 100dvh;`) — title card cover, loading overlay — so mobile URL-bar resizing can't trap content. iframe scrolling is CSS-controlled (`overflow: hidden` desktop / `auto` ≤768 in charts_lab), the deprecated `scrolling=""` attribute is not used.
  6. Fixed-position tooltips clamp with `max-width: calc(100vw - …)` at ≤480 so they can't hang off-screen.
- Data access via `composables/useApi.ts` (fetch wrappers), `composables/useWebSocket.ts` (chat), `composables/useBlogPosts.ts` + `useMarkdown.ts` (blog, uses `marked` + **DOMPurify**), `useAdminApi.ts` (admin panel), `useScreenBroadcast.ts` (WebRTC screen broadcast), `useAshParticles.ts`, `useCopyText.ts`.
- **Admin panel (`/admin`, admin-only workbench).** `AdminView.vue` is a sidebar-tab tool (概览/留言板/博客/评论/分享/用户/聊天日志/开发日志) with **server-side pagination + per-tab data cache**; data via `composables/useAdminApi.ts`. It is **deliberately exempt from the site's art style** — own design system (墨纸 + 朱砂 accent) isolated under the `.admin-app` prefix in `styles/admin.css`; UI copy is plain zh (internal tool, no i18n). Route guard waits for `useAuth().restored` (isAdmin isn't cached in localStorage) then bounces non-admins to `/`; deep-link via `?tab=`. The corner `AccountMenu` shows a 管理面板 item when `isAdmin`. Writes reuse existing endpoints (`PATCH /api/messages/:id`, `POST /api/devlog`, `DELETE /api/blog/:id`, `DELETE /api/blog/comments/:id`, `DELETE /api/share/:code`, `POST /api/auth/admin/reset-password`); only publish-toggle and share-cleanup call the admin router.
- **Blog is dual-source.** Static posts: `client/src/content/posts/*.md` (bundled at build; frontmatter; filename = slug). User posts: DB `blog_posts` rows with `author_username` + `body`, slug namespaced `u-*` — fetched via `/api/blog`, merged by `mergedPosts()` in `useBlogPosts.ts` (date desc). Detail resolves static synchronously, DB posts async via `GET /api/blog/:slug`. `POST/PUT/DELETE /api/blog[/:id]` = create/update/delete (author or admin; slug immutable; delete cascades comments/likes). Comments (`post_comments`) and likes (`post_likes`, one per user via UNIQUE) are **slug-keyed so static posts get them too**. `/blog/compose` (login-guarded) writes Markdown; server derives excerpt/readTime; drafts (`is_published=0`) are author-visible only — BlogView re-fetches on auth change to avoid stale identity cache. Client-side ComposeView ownership precheck refuses to prefill others' posts; server enforces on PUT/DELETE. User Markdown renders through `renderMarkdown()` which sanitifies with DOMPurify; comments render as plain text.

## Server rules

- **REST errors are machine codes, not prose:** every `4xx/5xx` JSON returns `{ error: 'CODE' }` (SCREAMING_SNAKE, e.g. `AUTH_INVALID_CREDENTIALS`, `SHARE_FILE_TOO_LARGE` + sibling params like `maxMb`/`min` where needed). The client maps them to localized text via the `api.*` i18n keys (`apiError()` in `stores/locale.ts`); unknown strings pass through verbatim. Don't put sentences in `error` fields. Legacy exceptions kept on purpose: `GET/POST /api/messages` and `GET /api/devlog` still return 200-with-`{error: e.message}` on DB failure (original PHP shape).
- **Express + mysql2/promise pool + express-session (MySQLStore on the shared pool, auto-creates `sessions` table) + bcryptjs + ws.** Entry `src/index.ts` mounts routers under `/api`, configures sessions, and in prod statically serves `client/dist` with SPA fallback (`GET *` → `index.html` unless path starts with `/api`).
- **Import paths use `.js` extensions** even though sources are `.ts` (ESM + Bundler resolution). Add modules as Express `Router`s in `src/routes/`.
- **Admin whitelist:** `server/src/admin.ts` — `sessionUsername(req)` / `isAdmin(req)`; admins = comma-separated `ADMIN_USERNAMES` in `.env` (unset → nobody is admin). Gates devlog writes, message moderation, share deletion.
- **Admin panel API** (`src/routes/admin.ts`, mounted at `/api/admin`, router-level middleware 401s the logged-out and 403s non-admins on **every** endpoint): `GET /overview` (counts across all 8 tables + hidden/draft/active breakdowns + 5 latest messages + 5 latest chat logs + server uptime/node/now, single round trip); `GET /messages|/devlog|/posts|/comments|/shares|/users|/logs` — paged lists (`?page&pageSize(10-100,def 20)&q`, q does escaped `LIKE` with `ESCAPE '\\'`; all include hidden rows/drafts; `id DESC`, posts by `date DESC,id DESC`; shares omit `content`, users carry posts/comments/likes/shares subselect counts); `PATCH /posts/:id/publish` (`{is_published:0|1}` quick toggle without full PUT); `POST /shares/cleanup` (purge expired share rows + their disk files). List shape is `{ rows, total, page, pageSize }`.
- **WS one-time tokens:** `server/src/wsTokens.ts` — `POST /api/auth/ws-token` issues a 60s single-use token (session required); the WS handshake URL `?token=` consumes it in-process to attach a username to the chat connection.
- **DB:** shared `mysql2/promise` pool in `src/db.ts`, creds from `.env` (never hardcoded). Always **parameterized queries** (`pool.query(sql, [params])`).
- **Schema** (`server/src/schema.sql`, 8 tables): `messages`, `devLog`, `users`, `logs`, `blog_posts`, `post_comments`, `post_likes`, `share_items`. Existing deployments upgrading to blog login-integration need the `blog_posts` ALTERs (slug/author_username/body/updated_at) + the two comment/like tables — noted in schema.sql; share ownership ALTER is historical.
- API surface (old PHP endpoints + login-adaptation additions):
  - `GET/POST /api/messages` — board. GET filters `is_displayed = 1`, orders `id DESC`, takes `?limit` (1-1000, default 500; admins see all rows incl. `id`/`is_displayed`). **Do not write `is_displayed` on insert** — it relies on the column default 1 or messages won't display. `PATCH /api/messages/:id` (`{is_displayed: 0|1}`) is admin-only moderation.
  - `GET/POST /api/devlog` — GET takes the same `?limit`; POST writes only `change_description` (timestamp is DB-generated) and is **admin-only** (401 not logged in / 403 not whitelisted).
  - `GET /api/blog` — user posts (`author_username IS NOT NULL`): published for everyone + own drafts when logged in, `date DESC`. Field aliases must match frontend `BlogPost` verbatim (`read_time AS readTime`, `author_username AS author`). `GET /api/blog/:slug` — single DB post incl. `body` (drafts: author/admin only, else 404). `POST /api/blog` (login) creates; server derives `slug` (`u-` namespace), `excerpt`, `read_time`, `date`. `PUT/DELETE /api/blog/:id` — author or admin (403 otherwise); delete cascades `post_comments`/`post_likes` by slug. `GET/POST /api/blog/:slug/comments` — list public / post login (1-2000 chars, drafts 404). `DELETE /api/blog/comments/:id` — comment author or admin. `GET/POST /api/blog/:slug/likes` — `{count, liked}` / login toggle (UNIQUE guarantees one per user). Static `.md` posts have no DB rows; comments/likes keyed by slug still work for them.
  - `POST /api/auth/signup|login` — `bcrypt.hash` (salt 10, signup enforces password ≥ 6 chars) / `bcrypt.compare`. `ER_DUP_ENTRY` → 400. On success set `req.session.username`; login responds `{username, isAdmin}`.
  - `GET /api/auth/me` — session check → `{username, isAdmin}` or 401. `POST /api/auth/logout` — destroys session + cookie. `POST /api/auth/change-password` — logged-in + old-password check. `POST /api/auth/ws-token` — one-time WS handshake token. `POST /api/auth/admin/reset-password` — admin-only reset (login + whitelist, cannot reset self, target user must exist).
  - `GET /api/share/mine` (logged-in, own uploads) and `DELETE /api/share/:code` (owner or admin; `/mine` must stay registered before `/:code`) are login-adaptation additions; text/file uploads record `uploader_user` when logged in.
- **WebSocket chat** (`src/ws/chatServer.ts`): separate `ws` server on its own port (9000 / `wss`+SSL), independent of Express. Identity: logged-in users connect with `?token=` (consumed via `wsTokens`) and are shown/keyed as `@username`; guests stay IP-keyed (same IP overwrites). Broadcast `<display>: <message>` to everyone *except* sender, log connect/disconnect/message to `logs` (sender = username or IP). Screen broadcast (WebRTC) signaling rides the same server as `RTC:`-prefixed frames (single live room, first-come-first-served; not broadcast, not logged).

## Cross-cutting

- Three client↔server channels stay distinct: REST `/api/*` (same-origin via Vite proxy in dev, direct in prod), WebSocket (separate port, URL from `VITE_WS_URL`), and the session cookie (auth lives in the cookie, not a client-sent token).
- `deploy/.deploy.env` (gitignored) holds SSH host/user/dir/PM2 app; deploy script strips CRLF from those values to survive Windows editing.
- `.env`, certs (`*.pem`/`*.key`, `server/certs/`), `logs/`, `devlogs/`, and `deploy/.deploy.env` are gitignored — never commit secrets.
