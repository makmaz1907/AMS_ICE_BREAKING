# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`bir-kelime-bir-islem` is a Turkish real-time ice-breaker game ("Bir Kelime Bir İşlem"): a Vite/React/TypeScript client plus a stateless HTTP API meant for Vercel. The host/projector screen is `/host` (any non-`/join` path); participants join on phones at `/join`. All UI text is Turkish.

The game runs on Vercel (`fra1`, production: https://bir-kelime-bir-islem-phi.vercel.app) with Upstash Redis for state and Ably for change notifications. It replaced an earlier Express + Socket.IO server (PR #1); host approval came in PR #2. Locally the same API runs in-memory without any keys.

See "Other documentation" at the end for `AGENTS.md` and `DEV_NOTES.md`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local API server (`tsx watch server/dev.ts`, port 3000, in-memory) + Vite (`0.0.0.0:5173`) via `concurrently` |
| `npm run build` | `tsc -b` type-check of `src`, `server` and `api`, then `vite build` into `dist` |
| `run-dev.bat` / `stop-server.bat` | Windows helpers: start dev / kill whatever is listening on port 3000 (fixes `EADDRINUSE`) |

There are no tests or linters. **`npm run build` is the only automated validation.** For behavior changes, run `npm run dev`, open `http://localhost:5173/host` (PIN `1234` locally), and join from another browser or a phone using the LAN URL in the QR code. On a phone, `localhost` points at the phone itself.

Env vars:
- `HOST_PIN`, `APP_SECRET`: locally they default to `1234` and a random per-process value. On Vercel (`VERCEL` set) neither has a default: without `HOST_PIN` host login is disabled, and without `APP_SECRET` no tokens can be issued. Production and Preview have different values for both.
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the Marketplace names `KV_REST_API_URL` / `KV_REST_API_TOKEN`): when set, the Redis store is used, otherwise the in-memory one.
- `ABLY_API_KEY`: when set, notifications go over Ably, otherwise over the dev server's SSE.
- `BKB_KEY_PREFIX` (optional): Redis key prefix, default `bkb:<VERCEL_ENV or dev>:`, so Preview and Production share one database without touching each other's data. The Ably channel is `bkb-<VERCEL_ENV or dev>`.
- `PORT`: dev server port, default 3000.

The Vercel variables are marked Sensitive, so `vercel env pull` can't fetch them; test Redis behavior against a preview deployment, not locally. Preview deployments are behind Vercel Deployment Protection (scripts need the `x-vercel-protection-bypass` header). Vite proxies `/api` to `localhost:3000`. The Redis free tier is from upstash.com directly; the Vercel Marketplace listing offered only paid plans.

## Code style

The code is very dense: many functions and all React page components sit on single lines, often hundreds of characters long. Read whole files rather than searching them, match the compact style when editing, and take `old_string` from a fresh read.

Server modules are native ESM and import siblings with a `.js` suffix (`./engine.js`) even though the files are `.ts`. `config/game.json` is imported with `with { type: "json" }`. There is a single `tsconfig.json` (`noEmit`).

## Architecture

**Layers** (`server/`):
- `engine.ts` holds all game rules and phase transitions. It talks to storage only through the `Store` interface and announces changes through a `Notifier`.
- `store.ts` defines `Store`, the `Meta` and team records and `createMemoryStore()`. Every `Store` method must be atomic on its own. The in-memory `version` starts at `Date.now()` so it keeps increasing across dev-server restarts: open pages ignore any version lower than one they have already seen.
- `redisStore.ts` implements the same contract on Upstash Redis, using Lua scripts for the compare-and-set of `Meta`, for `addSubmission` (which mirrors `isRoundOpen()`; keep the two in sync) and for the login counter. The client runs with `automaticDeserialization: false`, so values are raw strings and `HGETALL` returns a flat `[field, value, …]` list. Game data expires 2 days after its last write.
- `ably.ts` publishes versions over Ably REST and issues subscribe-only token requests for the browsers.
- `api.ts` (`handleApi`) is the single router for all `/api/*` routes, shared by Vercel and local dev.
- `api/[...path].ts` is the Vercel entry. It is one catch-all function because Hobby allows at most 12 functions per deployment, so add routes in `server/api.ts`, never as new files under `api/`. Route names must be a single path segment (`host-login`, not `host/login`): nested paths return Vercel's 404 without reaching the function.
- `dev.ts` is the local stand-in for Vercel. It adds two dev-only routes: `/api/events` (SSE in place of Ably) and `/api/join-url` (LAN address for the QR code).
- `runtime.ts` picks the store and transport from the env vars and wires them into the engine.
- `auth.ts` issues HMAC-signed tokens.
- `tdk.ts` does the TDK lookup.

**State:** `Meta` (`gameId`, `series`, `rev`, `phase`, `matchRound`, `round`, `pausedRemainingMs`) is a single record changed only through `mutate()`, which retries a compare-and-set on `rev`. Teams, scores (keyed by `gameId` + `series`) and submissions (keyed by round id) are stored separately. `gameId` changes on "Oyunu sıfırla", which invalidates every team token. `series` changes when a new game starts after the last round: scores start fresh and teams are kept. `config/game.json` is fixed at build/start time.

**Change flow:** every change bumps a global `version` and publishes only that number (SSE locally, Ably on Vercel; `GET /api/realtime` tells the client which). Clients then refetch `GET /api/state?v=<version>`. That response is CDN-cacheable (`s-maxage=30`), so many phones asking for the same version cost one function run; responses without `?v` are `no-store`, and only those correct the client's clock offset. Polling is a fallback only (60s while connected, 5s while not). Clients never patch state locally. `state()` reads `version` *before* the data, so a client may refetch needlessly but never pairs a stale state with a newer version. State hides `submissions` while a round is active and strips the number round's `solution` (it appears only as `numberSolution` in `round-results`).

**No server timers.** A round closes lazily: `tick()` closes it if `endsAt` has passed and it isn't paused. `GET /api/state` and `POST /api/tick` both call `tick()`, and the clients (`useGame` in `src/game.ts`) call `/api/tick` when their countdown reaches zero, retrying every 2s. The CAS in `mutate()` guarantees that exactly one caller performs each transition. Pause stores `pausedRemainingMs`, resume recomputes `endsAt`, and the state's `serverNow` lets clients correct for clock skew.

**Identity:** `POST /api/join` returns `{ gameId, teamId, token, name, teamStatus }` (`teamStatus`, not `status`: `post()` in `src/game.ts` puts the HTTP status code in `status`). The token is `HMAC(gameId|teamId)` and the phone stores it in `localStorage` as `bkb-team-token`, along with `bkb-team-id` and `bkb-team-name`. Public state exposes only `teamId`, never the token. A join with a token from the current game keeps the team, its name and its score. `JoinPage` rejoins automatically on load, on reconnect and when it sees a new `gameId`, but those calls send `rejoin: true`, which may only resume a team of the current game: with a token from an older game (or none) the server answers `{ ok: false, expired: true }` and creates nothing, and the phone shows the form with the old name filled in. Only a join the player submits creates a new team. Host login (`POST /api/host-login`, limited to 10 tries per IP per 10 min) returns a 12h host token, which the host page keeps in `sessionStorage` (`bkb-host-token`). `POST /api/host-command` requires it as a `Bearer` token and returns 401 otherwise.

**Host approval (step 4):** every team record has a `status`: `pending`, `approved`, `rejected` or `removed`. Records from before step 4 have no status and count as approved (`statusOf()`); likewise a `Meta` without `approvalRequired` counts as approval on (`approvalOn()`).
- With approval on (the default, switchable in the lobby and kept across "Oyunu sıfırla"), new teams start `pending`. Turning it off approves everyone pending.
- Only approved teams can submit. Only they appear in `teams`, the results, `winner` and the exports.
- The public state carries `statuses` (teamId → status, for teams that aren't approved) so a phone learns its own status, but never the names of those teams. Their names are only in `GET /api/host-state` (Bearer host token, never CDN-cached), which the host page reads instead of `/api/state`.
- Host commands: `approve` (pending or rejected), `reject` (pending), `remove` (approved or pending), `approve-all`, `approval` `{ enabled }`.
- `lobby` returns to the lobby (QR screen) from any phase, keeping the teams and the `gameId` but starting a new `series`, so scores begin at zero. `reset` additionally deletes every team. Both are reachable from every host screen and take two clicks (`ConfirmButton`).
- A rejoin with a valid token never renames the team and writes nothing, so it can't race an approval. A rejected or removed team may join again only under a different name (compared case-insensitively in Turkish), which creates a new pending team.
- The host screen is usually the projector, so pending names stay hidden until the host clicks "Göster". Removing a team from the scoreboard takes two clicks.

**Submissions (`POST /api/submit`):** word validation awaits a TDK lookup. Afterwards `store.addSubmission()` atomically re-checks that the round is still open (same round id, active, not paused, before `endsAt`), rejects an identical repeat, records the answer and adds its score. Keep that re-check inside the store operation; a check in the engine alone is racy. A team may submit several distinct answers per round, and each accepted one scores.

**Word validation** (`server/wordGame.ts` + `server/tdk.ts`): `canBuildWord` checks the letters and allows one joker, only at the index the player marked (`jokerIndex`). The TDK check calls the live API (`https://sozluk.gov.tr/gts?ara=`) over `wordVariants()` (I/İ, O/Ö, U/Ü, G/Ğ, C/Ç are interchangeable), with a 5s timeout. Results are cached in the store for 7 days. A failed lookup returns an error and records nothing. Meanings are stored on the submission and shown on the host results screen. TDK has been confirmed reachable from Vercel `fra1`.

**Number rounds** (`server/numberGame.ts`): 5 random digits 1–9 + one of {10,25,50,75,100}, target 100–999 (or `config.targetNumber` if in range). `evaluateNumberExpression` is a hand-written tokenizer/parser. **Never replace it with `eval`.** It allows each number at most once, requires exact division and keeps every intermediate result a positive integer. `solveNumbers()` runs at round creation. **Scoring happens when the round closes, not on submit** (`scoreNumberRound()`, called from `close()` in the engine by the one request whose compare-and-set closed the round, i.e. `finish` or `tick`; never from `lobby`/`reset`). Each approved team's closest valid answer counts. If any team hit the target exactly, those teams get 10 and everyone else 0. Otherwise the N teams with a valid answer get N, N-1, … 1 by distance, ties sharing the higher score (N minus the number of teams strictly closer). Teams without a valid answer get 0. `store.awardScores()` writes the points onto each team's best submission and into the score table in one step; number submissions are stored with score 0 until then.

**Duplicated client-side logic:** `src/pages/JoinPage.tsx` reimplements `matchingLetterIndex`/`canBuild` so users can't type words they can't build. If you change letter-matching or joker rules in `wordGame.ts`, change the copy in JoinPage too. `src/types.ts` mirrors the `state()` payload by hand; keep them in sync.

**Client:** `src/main.tsx` routes on `location.pathname` (no router library). `src/game.ts` exports `useGame()` (state, refetch on version, deadline tick, clock offset; given a host token it reads `/api/host-state` and calls `onUnauthorized` on a 401), `useRemainingSeconds()`, `post()` and `emptyState`. `src/realtime.ts` is the only place that knows the notification transport. Each page is a single component that switches its UI on `state.phase`. Styling uses Tailwind utilities plus shared classes (`.app-shell`, `.panel`) in `src/styles.css`. Use the NTT DATA brand variables in `src/theme.css` for brand colors. `src/Brand.tsx` has the NTT DATA logo (a PNG that already includes the brand guide's clear space, so don't crop or pad it) and `EventLogo`, the LE AMS ice breaker mark (inline SVG). The event mark always sits below the NTT DATA logo as a separate element and is never merged with it.

## Domain rules to preserve

- Normalize Turkish text with `toLocaleUpperCase("tr-TR")` / `toLocaleLowerCase("tr-TR")`, never default casing (i/İ/ı/I matter). Sort names with `localeCompare(..., "tr-TR")`.
- Word round: 8 distinct letters (exactly 3 weighted vowels + 5 weighted consonants, shuffled) + 1 joker. Score = letter count, +5 for a 9-letter word without the joker.
- Team names are trimmed and capped at 32 chars on the server; answers are capped at 64 chars; `add-time` accepts 1–600 seconds. Keep input validation on the server.
- Config fields `teamMode`, `predefinedTeams`, and `themedWord` are serialized to clients, but gameplay doesn't use them yet (`themedWord` is only displayed on word-round results). Don't assume they do anything.

## Other documentation

- `AGENTS.md` repeats these conventions for other coding agents. Keep it in sync when the architecture or the rules change.
- `DEV_NOTES.md` (Turkish) records the implemented features, what has been verified and the backlog of remaining work.
- `data/turkish-words.json` is a leftover from before the TDK lookup: it is gitignored and nothing reads it.
