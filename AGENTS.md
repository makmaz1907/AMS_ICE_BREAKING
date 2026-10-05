# AGENTS.md

## Project overview

`bir-kelime-bir-islem` is a Turkish-language real-time ice-breaker game. It pairs a Vite/React/TypeScript client with an Express and Socket.IO server. The host uses `/host` (the default route) to operate the game; participants use `/join` from mobile devices or other browsers.

## Essential commands

Run these from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts the Socket.IO/Express server in watch mode and the Vite client together. |
| `npm run dev:server` | Runs `server/index.ts` with `tsx watch`. |
| `npm run dev:client` | Starts Vite on all network interfaces at port `5173`. |
| `npm start` | Runs the server once with `tsx server/index.ts`. It serves the built client from `dist`. |
| `npm run build` | Type-checks with `tsc -b` and generates the Vite production build in `dist`. |
| `run-dev.bat` | Windows helper that changes to the repository directory and runs `npm run dev`. |
| `stop-server.bat` | Windows helper that forcibly stops the process listening on port `3000`. |

There are no test or lint scripts configured. Use `npm run build` as the available validation command after changes.

## Runtime and local access

- The server listens on `0.0.0.0:3000` by default. Override this with `PORT`.
- Host authentication uses `HOST_PIN`, defaulting to `1234`.
- Vite runs on `0.0.0.0:5173` and proxies `/api` and `/socket.io` to `http://localhost:3000` during development.
- The server computes a LAN join URL for the QR code. Use that URL from phones; `localhost` on a phone refers to the phone, not the host computer.
- If port `3000` is occupied, stop the existing server with `stop-server.bat`. When that script stops the backend, Vite can temporarily log Socket.IO `ECONNREFUSED` errors until the backend restarts.
- The production server serves static files from `dist`, so run `npm run build` before using `npm start` for the complete application.

## Code organization

- `server/index.ts` owns the in-memory game state, HTTP endpoints, Socket.IO event handlers, configuration loading, round transitions, scoring updates, and results exports.
- `server/wordGame.ts` contains Turkish letter generation, word normalization, build validation, and word scoring.
- `server/numberGame.ts` contains number-round generation, the safe arithmetic-expression parser/evaluator, scoring, and the best-solution search.
- `src/main.tsx` chooses `JoinPage` only for `/join`; all other paths render `HostPage`.
- `src/pages/HostPage.tsx` is the host/projector UI, including host PIN authentication, QR code, round controls, result review, and exports.
- `src/pages/JoinPage.tsx` is the participant UI. It persists a session ID and team name in `localStorage` and rejoins after Socket.IO reconnection.
- `src/socket.ts` exports the shared auto-connecting Socket.IO client.
- `src/types.ts` defines the client-side game-state contract. Keep it aligned with `gameState()` and serialization in `server/index.ts` whenever socket payloads change.
- `src/theme.css` defines NTT DATA brand variables and base typography. `src/styles.css` imports it, includes Tailwind directives, and contains shared component styles.
- `config/game.json` configures the rounds and optional game settings.
- `data/turkish-words.json` is the word-round dictionary.

## Game configuration

`config/game.json` is loaded synchronously by the server at startup. Invalid or unreadable configuration falls back to the defaults embedded in `loadConfig()`.

Observed fields:

- `rounds`: entries with `type` of `word` or `number` and `durationSeconds`.
- `teamMode`: `team` or `individual`.
- `predefinedTeams`: array of team names.
- `themedWord`: included in word-round result state.
- `targetNumber`: an optional number-round target, accepted only from 100 through 999.
- `targetDescription`: text shown with a number round.

Some configuration fields are serialized to the client but not all are wired into gameplay behavior. Preserve this distinction when changing config handling.

## Server and socket conventions

- State is process-local: teams, submissions, phase, active round, timer, and current round index are module-level variables. Restarting the server resets the game.
- Server events use colon-separated names such as `host:round:start`, `team:join`, and `round:submit`; state is broadcast as `game:state`.
- When adding or changing events, update both server listeners and the relevant page. Keep acknowledgement callback shapes compatible with callers.
- Call `broadcastState()` after every state mutation that clients need to observe.
- Word submissions are validated automatically against the public TDK dictionary endpoint (`https://sozluk.gov.tr/gts?ara=...`) before they score. Failed lookups return an error to the participant instead of creating a manual-review state. Every distinct accepted answer from a team is retained and scored during its round; identical repeat submissions are rejected.
- `gameState()` intentionally hides submissions while a word or number round is active and exposes them during results.
- Keep network-facing input validation on the server. Team names are trimmed and limited to 32 characters; submissions are validated against the current phase and round before scoring.

## Domain rules and safety constraints

- Normalize Turkish words with `toLocaleUpperCase("tr-TR")`; do not substitute default casing because Turkish `i`/`I` handling matters.
- Word-round letter matching treats `I`/`İ`, `O`/`Ö`, `U`/`Ü`, `G`/`Ğ`, and `C`/`Ç` as interchangeable. TDK validation tries these variants and preserves the returned dictionary meanings for the host results screen.
- Word rounds generate eight distinct letters plus one joker: exactly three weighted vowels and five weighted consonants. Letters may repeat in later rounds. The word validator permits one unavailable letter as the joker and scores only dictionary-valid words; a nine-letter word without the joker receives a bonus.
- Number expressions support `+`, `-`, `*`, `/`, `×`, `÷`, and parentheses. They must use supplied numbers at most once, divide exactly, and keep intermediate results as positive integers.
- Do not replace the arithmetic evaluator with `eval`. `evaluateNumberExpression()` deliberately tokenizes and parses expressions safely.
- Number-round solutions are generated by `solveNumbers()` and shown only in round results.

## Client conventions

- React function components and hooks are used throughout; TypeScript strict mode is enabled.
- Pages maintain a local `emptyState` matching `GameState` before the first server payload arrives.
- Socket listeners are registered in `useEffect` and explicitly removed in cleanup. Follow the same pattern for new listeners to avoid duplicate callbacks after remounts.
- Participant identity is stored under `bkb-session-id` and the team name under `bkb-team-name`; reconnect behavior depends on those keys.
- UI text is Turkish. Maintain Turkish locale-aware behavior where user-facing game input is normalized or compared.
- Styling combines Tailwind utility classes in JSX with shared CSS classes such as `.app-shell` and `.panel`. Use the existing CSS variables from `theme.css` for shared brand colors.

## Validation checklist

1. Run `npm run build` after TypeScript, client, server, configuration, or styling changes.
2. For interaction changes, start `npm run dev`, open the host UI, and join from another browser/device using the generated LAN URL.
3. Exercise the affected Socket.IO transition, especially reconnect behavior, pause/resume, submission replacement, and host word review where applicable.
4. For changes to arithmetic rules, check valid expressions, duplicate-number rejection, integer-only division, positive intermediate-result rejection, score thresholds, and solver output.
5. For changes to word rules, check Turkish casing, joker use, dictionary matching, and the nine-letter non-joker bonus.
