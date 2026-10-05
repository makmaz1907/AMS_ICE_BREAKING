# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`bir-kelime-bir-islem` is a Turkish real-time ice-breaker game ("Bir Kelime Bir İşlem"): a Vite/React/TypeScript client plus an Express + Socket.IO server. The host/projector screen is `/host` (any non-`/join` path); participants join on phones at `/join`. All UI text is Turkish.

`AGENTS.md` holds the detailed conventions and domain rules, and this file summarizes them. `DEV_NOTES.md` (in Turkish) has the feature history and a backlog of remaining work. Parts of both files are stale; see "Stale documentation" below.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Server (`tsx watch server/index.ts`, port 3000) + Vite (`0.0.0.0:5173`) together via `concurrently` |
| `npm run build` | `tsc -b` type-check of `src` and `server`, then `vite build` into `dist` |
| `npm start` | Run the server once; serves the built client from `dist` (build first) |
| `run-dev.bat` / `stop-server.bat` | Windows helpers: start dev / kill whatever is listening on port 3000 (fixes `EADDRINUSE`) |

There are no tests or linters. **`npm run build` is the only automated validation.** For behavior changes, run `npm run dev`, open the host page at `http://localhost:5173/host` (PIN from `HOST_PIN`, default `1234`), and join from another browser or a phone using the LAN URL in the QR code. On a phone, `localhost` points at the phone itself, not this machine.

Env vars: `PORT` (default 3000), `HOST_PIN` (default 1234). In dev, Vite proxies `/api` and `/socket.io` (with websockets) to `localhost:3000`.

## Architecture

**The server is the single source of truth, and all state lives in memory.** `server/index.ts` keeps module-level variables (`teams`, `phase`, `activeRound`, `submissions`, `roundTimer`, `matchRound`, `pausedRemainingMs`). Restarting the server resets the game. `config/game.json` is read once at startup. If it is missing or invalid, the server uses the defaults in `loadConfig()`.

**State flow:** every mutation must end with `broadcastState()`, which emits the full `gameState()` snapshot as `game:state` to all sockets. Clients never patch state locally; they just replace it. `gameState()` deliberately:
- returns `submissions: []` while a round is active (phase `word`/`number`) and exposes them only in results phases;
- strips `solution` from number rounds while they are active (`serializeRound`). The solution appears only as `numberSolution` in `round-results`.

`src/types.ts` mirrors this payload by hand. Keep it in sync with `gameState()`/`serializeRound()`/`serializeSubmissions()`, and with the `emptyState` constants duplicated in both pages.

**Phases:** `lobby` → (`word` | `number`) → `round-results` → … → `game-results`. `host:round:start` advances `matchRound` through `config.rounds`. Starting again after the last round resets scores and starts a new game. A `setTimeout` (`roundTimer`) calls `finishRound()`. Pause and add-time work by recomputing `activeRound.endsAt` and rescheduling the timer. Clients render their countdown from `endsAt`.

**Socket events** (colon-separated): `host:authenticate`, `host:round:start|finish|pause|add-time`, `host:teams:reset`, `team:join`, `round:submit`, `game:state:request`; the server emits `game:state`. Acknowledgement callbacks have the shape `{ ok, message? }`, and the clients depend on it. Note: the PIN check only gates the host UI. The `host:*` events themselves are not authenticated on the server.

**Submissions (`round:submit`):** validation is async for word rounds. The handler records `activeRound.id`, awaits validation, then **re-checks** the phase, round id, pause state and deadline before scoring. Keep this re-check whenever you touch the handler. Each team can submit several distinct answers per round. Every accepted answer adds to the score, and an identical repeat is rejected.

**Word validation** (`server/wordGame.ts` + `isTdkWord` in `index.ts`): `canBuildWord` checks letters and allows one joker. The dictionary check calls the live TDK API (`https://sozluk.gov.tr/gts?ara=`) over `wordVariants()` (I/İ, O/Ö, U/Ü, G/Ğ, C/Ç are interchangeable). It has a 5s timeout and a per-process cache. If the lookup fails, the participant gets an error and nothing is recorded. TDK meanings are stored on the submission and shown on the host results screen. Word rounds therefore need internet access.

**Number rounds** (`server/numberGame.ts`): 5 random digits 1–9 + one of {10,25,50,75,100}, target 100–999 (or `config.targetNumber` if in range). `evaluateNumberExpression` is a hand-written tokenizer/parser. **Never replace it with `eval`.** It enforces using each number at most once, exact division, and positive-integer intermediates. `solveNumbers()` runs at round creation. Score: exact 10, ±5 → 7, ±10 → 5.

**Duplicated client-side logic:** `src/pages/JoinPage.tsx` reimplements `matchingLetterIndex`/`canBuild` to stop users from typing words they can't build. If you change letter-matching or joker rules in `wordGame.ts`, change the copy in JoinPage too.

**Client:** `src/main.tsx` routes on `location.pathname` (no router library). `src/socket.ts` exports one auto-reconnecting socket shared by both pages. Each page is a single component file that switches its UI on `state.phase`. Register socket listeners in `useEffect` and remove them in cleanup. The participant's identity lives in `localStorage` under `bkb-session-id` and `bkb-team-name`. When a socket reconnects, the page re-emits `team:join` with the same session id, and the server keeps that team's score. Styling uses Tailwind utilities plus shared classes (`.app-shell`, `.panel`) in `src/styles.css`. Use the NTT DATA brand variables in `src/theme.css` for brand colors.

## Domain rules to preserve

- Normalize Turkish text with `toLocaleUpperCase("tr-TR")` / `toLocaleLowerCase("tr-TR")`, never default casing (i/İ/ı/I matter). Sort names with `localeCompare(..., "tr-TR")`.
- Word round: 8 distinct letters (exactly 3 weighted vowels + 5 weighted consonants, shuffled) + 1 joker. Score = letter count, +5 for a 9-letter word without the joker.
- Team names are trimmed and capped at 32 chars on the server. Keep input validation on the server.
- Config fields `teamMode`, `predefinedTeams`, and `themedWord` are serialized to clients, but gameplay doesn't use them yet (`themedWord` is only displayed on word-round results). Don't assume they do anything.

## Stale documentation

- `DEV_NOTES.md` and the AGENTS.md checklist mention host manual word approval and `data/turkish-words.json`. The current code has no manual review: TDK lookup alone decides validity, and nothing imports `data/turkish-words.json`.
- `DEV_NOTES.md` lists a hard-coded working directory from another machine. Ignore it.
