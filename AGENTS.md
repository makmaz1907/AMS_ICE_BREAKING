# AGENTS.md

## Project overview

`bir-kelime-bir-islem` is a Turkish-language real-time ice-breaker game. A Vite/React/TypeScript client talks to a stateless HTTP API that runs on Vercel, with Upstash Redis holding the game state and Ably carrying change notifications. The host uses `/host` (the default route) to run the game on the projector; participants join at `/join` from their phones.

Production: https://bir-kelime-bir-islem-phi.vercel.app

## Essential commands

Run these from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts the local API server (`server/dev.ts`, in-memory, port `3000`) in watch mode and the Vite client (`0.0.0.0:5173`) together. |
| `npm run dev:server` | Runs only `server/dev.ts` with `tsx watch`. |
| `npm run dev:client` | Runs only Vite on all network interfaces at port `5173`. |
| `npm run build` | Type-checks `src`, `server` and `api` with `tsc -b`, then builds the client into `dist`. |
| `npx vercel deploy` / `npx vercel deploy --prod` | Deploys a preview / production build. The GitHub repo isn't connected to Vercel, so pushes don't deploy on their own. |
| `run-dev.bat` | Windows helper that changes to the repository directory and runs `npm run dev`. |
| `stop-server.bat` | Windows helper that stops whatever is listening on port `3000`. |

There are no test or lint scripts. Use `npm run build` as the validation command after changes.

## Runtime and local access

- Locally everything runs in memory with no keys: restarting the dev server resets the game. `HOST_PIN` defaults to `1234` and `APP_SECRET` to a random per-process value.
- Vite proxies `/api` to `http://localhost:3000`. The dev server adds two local-only routes: `/api/events` (an SSE stream standing in for Ably) and `/api/join-url` (the LAN address for the QR code).
- Phones must use the LAN URL from the QR code; `localhost` on a phone refers to the phone itself.
- On Vercel the environment variables are `HOST_PIN`, `APP_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `ABLY_API_KEY`, set for Production and Preview (Preview has its own `HOST_PIN` and `APP_SECRET`). They are marked Sensitive, so `vercel env pull` can't fetch them; test Redis/Ably behavior on a preview deployment.
- Preview deployments are behind Vercel Deployment Protection; scripts need the `x-vercel-protection-bypass` header. Production is public.
- If port `3000` is occupied (`EADDRINUSE`), run `stop-server.bat`.

## Code organization

- `server/engine.ts` holds all game rules: phase transitions, scoring, joining, submissions, host commands and host approval. It reads and writes data only through the `Store` interface.
- `server/store.ts` defines `Store`, the `Meta` and team records, and the in-memory store. `server/redisStore.ts` implements the same contract on Upstash Redis with Lua scripts.
- `server/api.ts` is the single router for all `/api/*` routes. `api/[...path].ts` is the only Vercel function and just calls it.
- `server/runtime.ts` picks Redis or memory, and Ably or SSE, from the environment variables. `server/dev.ts` is the local server.
- `server/auth.ts` issues and checks the HMAC-signed team and host tokens. `server/ably.ts` publishes notifications and issues subscribe-only tokens. `server/tdk.ts` looks words up in the TDK dictionary.
- `server/wordGame.ts` has letter generation, normalization, build validation and word scoring. `server/numberGame.ts` has number-round generation, the safe expression parser, scoring and the solver.
- `src/main.tsx` renders `JoinPage` only for `/join` and `HostPage` for every other path.
- `src/game.ts` has the shared `useGame()` hook (state, notifications, the deadline tick, clock correction), `post()` and `emptyState`. `src/realtime.ts` is the only file that knows about Ably or SSE.
- `src/pages/HostPage.tsx` is the host/projector UI; `src/pages/JoinPage.tsx` is the participant UI.
- `src/types.ts` mirrors the state payload by hand. Keep it aligned with `state()` and `hostState()` in `server/engine.ts`.
- `src/theme.css` defines the NTT DATA brand variables; `src/styles.css` imports it and holds Tailwind directives and shared classes.

## Game configuration

`config/game.json` is imported at build time.

- `rounds`: entries with `type` (`word` or `number`) and `durationSeconds`.
- `targetNumber`: optional number-round target, used only if it is within 100–999.
- `targetDescription`: text shown with a number round.
- `teamMode`, `predefinedTeams`, `themedWord`: sent to the client, but gameplay doesn't use them yet (`themedWord` is only shown on word-round results).

## Server and API conventions

- State is never kept in function memory on Vercel: every request reads Redis. Every `Store` method must be atomic on its own.
- Change the game meta only through `mutate()` in the engine (compare-and-set on `rev`, retried). Never write it directly.
- Each change bumps a global version and publishes only that number. Clients refetch `GET /api/state?v=<version>`, which the CDN may cache; host-only data goes through `GET /api/host-state`, which is never cached.
- There are no server timers. A round is closed by whoever notices first that its time has run out (`/api/tick`, `/api/state`, or the clients' countdowns); the compare-and-set lets only one caller win.
- A submission is re-checked against the current round inside `store.addSubmission()` (same round, open, not paused, before the deadline) after the TDK lookup. Keep that check inside the store operation.
- Add new routes to `server/api.ts`, never as new files under `api/` (Vercel Hobby allows 12 functions). Route names must be a single path segment, such as `host-login`, because nested paths never reach the catch-all function.
- Host commands go to `POST /api/host-command` with a `Bearer` host token. Acknowledgements have the shape `{ ok, message? }`.
- Keep input validation on the server: team names are trimmed and capped at 32 characters, answers at 64, and `add-time` accepts 1–600 seconds.

## Domain rules and safety constraints

- Normalize Turkish text with `toLocaleUpperCase("tr-TR")` / `toLocaleLowerCase("tr-TR")`, never default casing, because `i`/`İ`/`ı`/`I` matter. Sort names with `localeCompare(..., "tr-TR")`.
- Word rounds generate eight distinct letters (exactly three weighted vowels and five weighted consonants) plus one joker. The joker may stand only at the position the player marked. `I`/`İ`, `O`/`Ö`, `U`/`Ü`, `G`/`Ğ` and `C`/`Ç` are interchangeable when matching letters and looking words up.
- Word validity is decided only by the live TDK dictionary (`https://sozluk.gov.tr/gts`). There is no manual review. A failed lookup returns an error and records nothing. Word rounds need internet access.
- Word score is the letter count, with +5 for a nine-letter word without the joker. Number scores: exact 10, within 5 → 7, within 10 → 5.
- Number expressions support `+`, `-`, `*`, `/`, `×`, `÷` and parentheses. Each number may be used at most once, division must be exact, and every intermediate result must be a positive integer. Never replace `evaluateNumberExpression()` with `eval`.
- The number round's best solution (`solveNumbers()`) is shown only in round results.
- `JoinPage.tsx` duplicates the letter-matching and joker rules so phones can't type words they can't build. Change both copies together.
- Host approval: teams are `pending`, `approved`, `rejected` or `removed`. Only approved teams can submit or appear in the scoreboard, results and exports. The public state must never carry the names of teams that aren't approved. A rejoin never renames a team.

## Client conventions

- React function components and hooks; TypeScript strict mode. The code is written very compactly, often one long line per component or function. Match that style.
- Clients never patch state locally: they replace it with what the server returns.
- The participant's identity is in `localStorage` (`bkb-team-token`, `bkb-team-id`, `bkb-team-name`); the host token is in `sessionStorage` (`bkb-host-token`).
- UI text is Turkish.
- Styling combines Tailwind classes with shared classes such as `.app-shell` and `.panel`. Use the variables from `theme.css` for brand colors.

## Validation checklist

1. Run `npm run build` after any change.
2. For interaction changes, run `npm run dev`, open `http://localhost:5173/host` and join from another browser or phone using the LAN URL.
3. Exercise the affected flow: joining and approval, reconnecting after a reload, pause/resume and +15 s, a round ending on its own, results and exports.
4. For changes to the store, the engine's concurrency or the API, also test on a preview deployment (`npx vercel deploy`), because only there do Redis, Ably and several function instances run together.
5. For changes to the number rules, check valid expressions, reuse of a number, inexact division, non-positive intermediate results, the score thresholds and the solver.
6. For changes to the word rules, check Turkish casing, joker placement, the TDK lookup and the nine-letter bonus.
