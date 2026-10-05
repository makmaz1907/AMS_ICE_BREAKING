# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`bir-kelime-bir-islem` is a Turkish real-time ice-breaker game ("Bir Kelime Bir İşlem"): a Vite/React/TypeScript client plus a stateless HTTP API meant for Vercel. The host/projector screen is `/host` (any non-`/join` path); participants join on phones at `/join`. All UI text is Turkish.

**Migration in progress (branch `vercel-migration`).** Express and Socket.IO were replaced by an HTTP API (step 3b, done). Step 3c adds a Redis store (Upstash) and Ably notifications so the API runs on Vercel; until then only the in-memory mode works, and only locally. Step 4 adds host approval of joining teams.

`AGENTS.md` and `DEV_NOTES.md` (in Turkish) predate the migration; see "Stale documentation" below.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local API server (`tsx watch server/dev.ts`, port 3000, in-memory) + Vite (`0.0.0.0:5173`) via `concurrently` |
| `npm run build` | `tsc -b` type-check of `src`, `server` and `api`, then `vite build` into `dist` |
| `run-dev.bat` / `stop-server.bat` | Windows helpers: start dev / kill whatever is listening on port 3000 (fixes `EADDRINUSE`) |

There are no tests or linters. **`npm run build` is the only automated validation.** For behavior changes, run `npm run dev`, open `http://localhost:5173/host` (PIN `1234` locally), and join from another browser or a phone using the LAN URL in the QR code. On a phone, `localhost` points at the phone itself.

Env vars: `PORT` (dev server, default 3000), `HOST_PIN`, `APP_SECRET`. Locally `HOST_PIN` defaults to `1234` and `APP_SECRET` to a random per-process value. On Vercel (`VERCEL` set) neither has a default: without `HOST_PIN` host login is disabled, and without `APP_SECRET` no tokens can be issued. Vite proxies `/api` to `localhost:3000`.

## Code style

The code is very dense: many functions and all React page components sit on single lines, often hundreds of characters long. Read whole files rather than searching them, match the compact style when editing, and take `old_string` from a fresh read.

Server modules are native ESM and import siblings with a `.js` suffix (`./engine.js`) even though the files are `.ts`. `config/game.json` is imported with `with { type: "json" }`. There is a single `tsconfig.json` (`noEmit`).

## Architecture

**Layers** (`server/`):
- `engine.ts` holds all game rules and phase transitions. It talks to storage only through the `Store` interface and announces changes through a `Notifier`.
- `store.ts` defines `Store`, the `Meta` record and `createMemoryStore()`. Every `Store` method must be atomic on its own. The Redis store (step 3c) must implement the same contract with Lua scripts.
- `api.ts` (`handleApi`) is the single router for all `/api/*` routes, shared by Vercel and local dev.
- `api/[...path].ts` is the Vercel entry. It is one catch-all function because Hobby allows at most 12 functions per deployment, so add routes in `server/api.ts`, never as new files under `api/`.
- `dev.ts` is the local stand-in for Vercel. It adds two dev-only routes: `/api/events` (SSE in place of Ably) and `/api/join-url` (LAN address for the QR code).
- `runtime.ts` wires the store and notifier together.
- `auth.ts` issues HMAC-signed tokens.
- `tdk.ts` does the TDK lookup.

**State:** `Meta` (`gameId`, `series`, `rev`, `phase`, `matchRound`, `round`, `pausedRemainingMs`) is a single record changed only through `mutate()`, which retries a compare-and-set on `rev`. Teams, scores (keyed by `gameId` + `series`) and submissions (keyed by round id) are stored separately. `gameId` changes on "Oyunu sıfırla", which invalidates every team token. `series` changes when a new game starts after the last round: scores start fresh and teams are kept. `config/game.json` is fixed at build/start time.

**Change flow:** every change bumps a global `version` and publishes only that number (SSE locally, Ably in 3c). Clients then refetch `GET /api/state`. Clients never patch state locally. `state()` reads `version` *before* the data, so a client may refetch needlessly but never pairs a stale state with a newer version. State hides `submissions` while a round is active and strips the number round's `solution` (it appears only as `numberSolution` in `round-results`).

**No server timers.** A round closes lazily: `tick()` closes it if `endsAt` has passed and it isn't paused. `GET /api/state` and `POST /api/tick` both call `tick()`, and the clients (`useGame` in `src/game.ts`) call `/api/tick` when their countdown reaches zero, retrying every 2s. The CAS in `mutate()` guarantees that exactly one caller performs each transition. Pause stores `pausedRemainingMs`, resume recomputes `endsAt`, and the state's `serverNow` lets clients correct for clock skew.

**Identity:** `POST /api/join` returns `{ gameId, teamId, token }`. The token is `HMAC(gameId|teamId)` and the phone stores it in `localStorage` as `bkb-team-token`, along with `bkb-team-id` and `bkb-team-name`. Public state exposes only `teamId`, never the token. A join with a token from the current game keeps the team (and its score). A token from an older `gameId` creates a new team, and `JoinPage` rejoins automatically when it sees a new `gameId`. Host login (`POST /api/host/login`, limited to 10 tries per IP per 10 min) returns a 12h host token, which the host page keeps in `sessionStorage` (`bkb-host-token`). `POST /api/host/command` requires it as a `Bearer` token and returns 401 otherwise.

**Submissions (`POST /api/submit`):** word validation awaits a TDK lookup. Afterwards `store.addSubmission()` atomically re-checks that the round is still open (same round id, active, not paused, before `endsAt`), rejects an identical repeat, records the answer and adds its score. Keep that re-check inside the store operation; a check in the engine alone is racy. A team may submit several distinct answers per round, and each accepted one scores.

**Word validation** (`server/wordGame.ts` + `server/tdk.ts`): `canBuildWord` checks the letters and allows one joker, only at the index the player marked (`jokerIndex`). The TDK check calls the live API (`https://sozluk.gov.tr/gts?ara=`) over `wordVariants()` (I/İ, O/Ö, U/Ü, G/Ğ, C/Ç are interchangeable), with a 5s timeout. Results are cached in the store for 7 days. A failed lookup returns an error and records nothing. Meanings are stored on the submission and shown on the host results screen. TDK has been confirmed reachable from Vercel `fra1`. `GET /api/tdk-check` is a temporary diagnostic to remove in 3c.

**Number rounds** (`server/numberGame.ts`): 5 random digits 1–9 + one of {10,25,50,75,100}, target 100–999 (or `config.targetNumber` if in range). `evaluateNumberExpression` is a hand-written tokenizer/parser. **Never replace it with `eval`.** It allows each number at most once, requires exact division and keeps every intermediate result a positive integer. `solveNumbers()` runs at round creation. Score: exact 10, ±5 → 7, ±10 → 5.

**Duplicated client-side logic:** `src/pages/JoinPage.tsx` reimplements `matchingLetterIndex`/`canBuild` so users can't type words they can't build. If you change letter-matching or joker rules in `wordGame.ts`, change the copy in JoinPage too. `src/types.ts` mirrors the `state()` payload by hand; keep them in sync.

**Client:** `src/main.tsx` routes on `location.pathname` (no router library). `src/game.ts` exports `useGame()` (state, refetch on version, deadline tick, clock offset), `useRemainingSeconds()`, `post()` and `emptyState`. `src/realtime.ts` is the only place that knows the notification transport. Each page is a single component that switches its UI on `state.phase`. Styling uses Tailwind utilities plus shared classes (`.app-shell`, `.panel`) in `src/styles.css`. Use the NTT DATA brand variables in `src/theme.css` for brand colors.

## Domain rules to preserve

- Normalize Turkish text with `toLocaleUpperCase("tr-TR")` / `toLocaleLowerCase("tr-TR")`, never default casing (i/İ/ı/I matter). Sort names with `localeCompare(..., "tr-TR")`.
- Word round: 8 distinct letters (exactly 3 weighted vowels + 5 weighted consonants, shuffled) + 1 joker. Score = letter count, +5 for a 9-letter word without the joker.
- Team names are trimmed and capped at 32 chars on the server; answers are capped at 64 chars; `add-time` accepts 1–600 seconds. Keep input validation on the server.
- Config fields `teamMode`, `predefinedTeams`, and `themedWord` are serialized to clients, but gameplay doesn't use them yet (`themedWord` is only displayed on word-round results). Don't assume they do anything.

## Stale documentation

- `AGENTS.md` and `DEV_NOTES.md` still describe the Express + Socket.IO server (`server/index.ts`, socket events, `npm start`), host manual word approval and `data/turkish-words.json`. None of those exist anymore. `data/turkish-words.json` is gitignored and unused.
- `DEV_NOTES.md` lists a hard-coded working directory from another machine. Ignore it.
