import crypto from "node:crypto";
import rawConfig from "../config/game.json" with { type: "json" };
import { hostPin, hostToken, pinMatches, readTeamToken, teamToken } from "./auth.js";
import { createNumberRound, evaluateNumberExpression, scoreNumberRound, type NumberRound } from "./numberGame.js";
import { approvalOn, initialMeta, liveResultOn, scoreboardMode, isActive, isExpired, isRoundOpen, statusOf, type Meta, type Store, type Submission, type TeamRecord, type TeamStatus } from "./store.js";
import { lookupTdk, type TdkLookup } from "./tdk.js";
import { canBuildWord, createWordRound, normalizeTurkish, scoreWord } from "./wordGame.js";

type RoundConfig = { type: "word" | "number"; durationSeconds: number };
type GameConfig = { rounds: RoundConfig[]; teamMode: "team" | "individual"; predefinedTeams: string[]; themedWord: string; targetNumber: number | null; targetDescription: string };
export type Notifier = { publish(version: number): Promise<void> };
export type Result = { ok: boolean; message?: string };
export type HostAction = "start" | "finish" | "pause" | "add-time" | "reset" | "lobby" | "approval" | "live-result" | "scoreboard";
type Body = Record<string, unknown>;
export type Engine = ReturnType<typeof createEngine>;
type PublicState = Record<string, unknown> & { version: number };

// Word and number rounds alternate: Bir Kelime, Bir İşlem, …
const defaults: GameConfig = { rounds: [{ type: "word", durationSeconds: 60 }, { type: "number", durationSeconds: 90 }, { type: "word", durationSeconds: 60 }, { type: "number", durationSeconds: 90 }, { type: "word", durationSeconds: 60 }], teamMode: "team", predefinedTeams: [], themedWord: "", targetNumber: null, targetDescription: "" };
const parsed = rawConfig as Partial<GameConfig>;
const config: GameConfig = { ...defaults, ...parsed, rounds: parsed.rounds?.length ? parsed.rounds : defaults.rounds };
// Extra points, once per team, for the round's longest accepted word (ties all get it).
const longestWordBonus = 5;
const closedMessage = "Bu tur için cevap kabul edilmiyor.";
const fail = (message: string) => ({ ok: false, message });
const sameName = (left: string, right: string) => left.toLocaleUpperCase("tr-TR") === right.toLocaleUpperCase("tr-TR");
// Which host action moves a team from which statuses to which.
const teamTransitions: Record<string, { from: TeamStatus[]; to: TeamStatus }> = { approve: { from: ["pending", "rejected"], to: "approved" }, reject: { from: ["pending"], to: "rejected" }, remove: { from: ["approved", "pending"], to: "removed" } };
const refusal: Record<TeamStatus, string> = { pending: "Takımınız henüz host tarafından onaylanmadı.", approved: "", rejected: "Katılımınız reddedildi. Farklı bir adla tekrar deneyebilirsiniz.", removed: "Oyundan çıkarıldınız. Farklı bir adla tekrar katılabilirsiniz." };

export function createEngine(store: Store, notifier: Notifier) {
  async function changed() { await notifier.publish(await store.bumpVersion()); }
  // Optimistic update of the game meta: retried when another request changed it in between, so concurrent host commands and ticks never overwrite each other.
  async function mutate(change: (meta: Meta) => Meta | null) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const meta = await store.readMeta();
      const next = change(structuredClone(meta));
      if (!next) return null;
      if (await store.writeMeta({ ...next, rev: meta.rev + 1 }, meta.rev)) { await changed(); return next; }
    }
    throw new Error("Oyun durumu güncellenemedi.");
  }
  function finished(meta: Meta): Meta { return { ...meta, pausedRemainingMs: null, phase: meta.matchRound >= config.rounds.length ? "game-results" : "round-results" }; }
  // There is no server timer on Vercel: whoever notices an expired round first closes it. Safe to call any number of times.
  function tick() { return close((meta) => isExpired(meta, Date.now()) ? finished(meta) : null); }
  // Closes the active round. Only the request whose compare-and-set actually closed it scores a number round, so points are given once.
  async function close(change: (meta: Meta) => Meta | null) {
    const next = await mutate(change);
    if (next?.round && "numbers" in next.round) await awardNumberRound(next, next.round);
    if (next?.round && "letters" in next.round) await awardLongestWord(next, next.round.id);
    return next;
  }
  async function approvedTeamIds(meta: Meta) { return new Set((await store.listTeams(meta.gameId)).filter((team) => statusOf(team) === "approved").map((team) => team.id)); }
  async function awardLongestWord(meta: Meta, roundId: string) {
    const [submissions, approved] = await Promise.all([store.listSubmissions(roundId), approvedTeamIds(meta)]);
    const accepted = submissions.filter((submission) => submission.status === "accepted" && approved.has(submission.teamId));
    if (!accepted.length) return;
    const length = (submission: Submission) => Array.from(submission.answer).length;
    const longest = Math.max(...accepted.map(length));
    const winners = new Map<string, Submission>();
    for (const submission of accepted) if (length(submission) === longest && !winners.has(submission.teamId)) winners.set(submission.teamId, submission);
    await store.awardScores(meta, roundId, [...winners.values()].map((submission) => ({ submission: { ...submission, score: submission.score + longestWordBonus, longest: true }, points: longestWordBonus })));
    await changed();
  }
  async function awardNumberRound(meta: Meta, round: NumberRound) {
    const [submissions, teams] = await Promise.all([store.listSubmissions(round.id), store.listTeams(meta.gameId)]);
    const approved = new Set(teams.filter((team) => statusOf(team) === "approved").map((team) => team.id));
    const best = new Map<string, Submission>();
    for (const submission of submissions) {
      if (submission.status !== "accepted" || submission.value === undefined || !approved.has(submission.teamId)) continue;
      const current = best.get(submission.teamId);
      if (!current || Math.abs(submission.value - round.target) < Math.abs(current.value! - round.target)) best.set(submission.teamId, submission);
    }
    const points = scoreNumberRound([...best.values()].map((submission) => ({ teamId: submission.teamId, value: submission.value! })), round.target);
    if (!best.size) return;
    await store.awardScores(meta, round.id, [...best.values()].map((submission) => ({ submission: { ...submission, score: points.get(submission.teamId) ?? 0 }, points: points.get(submission.teamId) ?? 0 })));
    await changed();
  }

  const commands: Record<HostAction, (meta: Meta, body: Body) => Meta | null> = {
    start: (meta) => {
      const next = meta.matchRound >= config.rounds.length ? { ...meta, series: meta.series + 1, matchRound: 1 } : { ...meta, matchRound: meta.matchRound + 1 };
      const current = config.rounds[next.matchRound - 1];
      const round = current.type === "word" ? createWordRound(current.durationSeconds) : createNumberRound(current.durationSeconds, config.targetNumber, config.targetDescription);
      return { ...next, round, phase: current.type, pausedRemainingMs: null };
    },
    finish: (meta) => isActive(meta) ? finished(meta) : null,
    pause: (meta) => {
      if (!isActive(meta) || !meta.round) return null;
      if (meta.pausedRemainingMs === null) return { ...meta, pausedRemainingMs: Math.max(0, meta.round.endsAt - Date.now()) };
      return { ...meta, round: { ...meta.round, endsAt: Date.now() + meta.pausedRemainingMs }, pausedRemainingMs: null };
    },
    "add-time": (meta, body) => {
      const seconds = Number(body.seconds);
      if (!isActive(meta) || !meta.round || !(seconds > 0 && seconds <= 600)) return null;
      return meta.pausedRemainingMs !== null ? { ...meta, pausedRemainingMs: meta.pausedRemainingMs + seconds * 1000 } : { ...meta, round: { ...meta.round, endsAt: meta.round.endsAt + seconds * 1000 } };
    },
    // The host's settings survive a reset; everything else starts over.
    reset: (meta) => ({ ...initialMeta(), approvalRequired: approvalOn(meta), liveResult: liveResultOn(meta), scoreboard: scoreboardMode(meta) }),
    // Back to the lobby (QR screen) from any phase, keeping the teams: a new series starts so scores begin at zero.
    lobby: (meta) => meta.phase === "lobby" ? null : { ...meta, series: meta.series + 1, phase: "lobby", matchRound: 0, round: null, pausedRemainingMs: null },
    approval: (meta, body) => typeof body.enabled === "boolean" && body.enabled !== approvalOn(meta) ? { ...meta, approvalRequired: body.enabled } : null,
    scoreboard: (meta, body) => (body.mode === "open" || body.mode === "freeze" || body.mode === "hidden") && body.mode !== scoreboardMode(meta) ? { ...meta, scoreboard: body.mode } : null,
    "live-result": (meta, body) => typeof body.enabled === "boolean" && body.enabled !== liveResultOn(meta) ? { ...meta, liveResult: body.enabled } : null,
  };

  // Only approved teams play: they alone appear in the scoreboard, the results and the exports.
  async function rankedTeams(meta: Meta, teams?: TeamRecord[]) {
    const [all, scores] = await Promise.all([teams ?? store.listTeams(meta.gameId), store.scores(meta.gameId, meta.series)]);
    return all.filter((team) => statusOf(team) === "approved").map((team) => ({ id: team.id, name: team.name, score: scores[team.id] ?? 0 })).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "tr-TR"));
  }
  // Totals are hidden from every screen (including the projector) until the final results, per the host's scoreboard setting.
  function scoresHidden(meta: Meta) {
    if (meta.phase === "game-results" || meta.matchRound === 0) return false;
    const mode = scoreboardMode(meta);
    return mode === "hidden" || (mode === "freeze" && meta.matchRound >= config.rounds.length - 1);
  }
  // While hidden, totals go out as 0 and teams in name order, so neither the numbers nor the ranking leak to phones or the network.
  function publicTeams(meta: Meta, ranked: Array<{ id: string; name: string; score: number }>) {
    return scoresHidden(meta) ? ranked.map((team) => ({ ...team, score: 0 })).sort((left, right) => left.name.localeCompare(right.name, "tr-TR")) : ranked;
  }
  async function roundSubmissions(meta: Meta, teams: Array<{ id: string; name: string }>) {
    if (!meta.round) return [];
    const names = new Map(teams.map((team) => [team.id, team.name]));
    return (await store.listSubmissions(meta.round.id)).filter((submission) => names.has(submission.teamId)).map((submission) => ({ ...submission, teamName: names.get(submission.teamId) ?? "Bilinmeyen takım" })).sort((left, right) => right.score - left.score || left.teamName.localeCompare(right.teamName, "tr-TR"));
  }
  function serializeRound(meta: Meta) {
    const round = meta.round;
    const durationSeconds = config.rounds[meta.matchRound - 1]?.durationSeconds ?? 0;
    if (!round || !isActive(meta)) return null;
    if ("letters" in round) return { type: "word" as const, ...round, durationSeconds, themedWord: config.themedWord || null };
    return { type: "number" as const, id: round.id, numbers: round.numbers, target: round.target, description: round.description, endsAt: round.endsAt, durationSeconds };
  }

  async function state(): Promise<PublicState> {
    // Read the version before the data, so a client may refetch needlessly but never keeps a stale state under a newer version.
    const version = await store.readVersion();
    const meta = await store.readMeta();
    if (isExpired(meta, Date.now())) { await tick(); return state(); }
    const all = await store.listTeams(meta.gameId);
    const teams = publicTeams(meta, await rankedTeams(meta, all));
    const roundType = config.rounds[meta.matchRound - 1]?.type ?? null;
    const showResults = meta.phase === "round-results" || meta.phase === "game-results";
    return {
      gameId: meta.gameId, version, serverNow: Date.now(), phase: meta.phase, teams, round: serializeRound(meta),
      submissions: showResults ? await roundSubmissions(meta, teams) : [], matchRound: meta.matchRound, totalRounds: config.rounds.length, roundType, teamMode: config.teamMode,
      winner: meta.phase === "game-results" ? teams[0] ?? null : null,
      numberSolution: meta.phase === "round-results" && meta.round && "solution" in meta.round ? meta.round.solution : null,
      themedWord: meta.phase === "round-results" && roundType === "word" ? config.themedWord || null : null,
      paused: meta.pausedRemainingMs !== null, remainingMs: meta.pausedRemainingMs,
      // Phones learn their own approval status from here; names of teams that aren't approved are only in hostState().
      approvalRequired: approvalOn(meta), liveResult: liveResultOn(meta), scoreboard: scoreboardMode(meta), scoresHidden: scoresHidden(meta), statuses: Object.fromEntries(all.filter((team) => statusOf(team) !== "approved").map((team) => [team.id, statusOf(team)])),
    };
  }
  async function approveAll(meta: Meta) {
    const pending = (await store.listTeams(meta.gameId)).filter((team) => statusOf(team) === "pending");
    await Promise.all(pending.map((team) => store.saveTeam(meta.gameId, { ...team, status: "approved" })));
    if (pending.length) await changed();
  }

  async function isTdkWord(word: string): Promise<TdkLookup | null> {
    const cached = await store.getCache(`tdk:${word}`);
    if (cached) return JSON.parse(cached) as TdkLookup;
    const lookup = await lookupTdk(word);
    if (lookup) await store.setCache(`tdk:${word}`, JSON.stringify(lookup), 7 * 24 * 60 * 60);
    return lookup;
  }
  async function validateWord(teamId: string, rawWord: string, jokerIndex: number | null, round: NonNullable<Meta["round"]>): Promise<Submission | null> {
    const answer = normalizeTurkish(rawWord);
    const build = "letters" in round ? canBuildWord(answer, round, jokerIndex) : { valid: false, jokerUsed: false };
    if (!build.valid) return { teamId, answer, buildValid: false, jokerUsed: build.jokerUsed, status: "rejected", score: 0 };
    const lookup = await isTdkWord(answer);
    if (lookup === null) return null;
    return { teamId, answer, dictionaryValid: lookup.valid, meanings: lookup.meanings, buildValid: true, jokerUsed: build.jokerUsed, status: lookup.valid ? "accepted" : "rejected", score: lookup.valid ? scoreWord(answer, true, build.jokerUsed) : 0 };
  }
  function validateNumber(teamId: string, expression: string, round: NonNullable<Meta["round"]>): Submission {
    const result = "numbers" in round ? evaluateNumberExpression(expression, round.numbers) : { valid: false, message: "Tur bulunamadı." };
    if (!result.valid || !("target" in round)) return { teamId, answer: expression, buildValid: false, status: "rejected", score: 0 };
    // Scored later, when the round closes (awardNumberRound).
    return { teamId, answer: expression, value: result.value, buildValid: true, status: "accepted", score: 0 };
  }

  return {
    state,
    tick,
    // Not CDN-cached (GET /api/host-state): adds the names of teams waiting for approval, oldest first.
    async hostState() {
      const [current, meta] = await Promise.all([state(), store.readMeta()]);
      const pendingTeams = (await store.listTeams(meta.gameId)).filter((team) => statusOf(team) === "pending").sort((left, right) => (left.joinedAt ?? 0) - (right.joinedAt ?? 0)).map((team) => ({ id: team.id, name: team.name }));
      return { ...current, pendingTeams };
    },
    async command(action: unknown, body: Body): Promise<Result> {
      if (action === "approve-all") { await approveAll(await store.readMeta()); return { ok: true }; }
      if (typeof action === "string" && action in teamTransitions) {
        const { from, to } = teamTransitions[action];
        const meta = await store.readMeta();
        const team = typeof body.teamId === "string" ? await store.getTeam(meta.gameId, body.teamId) : null;
        if (!team || !from.includes(statusOf(team))) return fail("Bu takım için bu işlem yapılamaz.");
        await store.saveTeam(meta.gameId, { ...team, status: to });
        await changed();
        return { ok: true };
      }
      if (typeof action !== "string" || !(action in commands)) return fail("Bilinmeyen komut.");
      const change = (meta: Meta) => commands[action as HostAction](meta, body);
      const next = action === "finish" ? await close(change) : await mutate(change);
      // Turning approval off lets everyone who is still waiting in.
      if (action === "approval" && next && !approvalOn(next)) await approveAll(next);
      return { ok: true };
    },
    // rejoinOnly: an automatic rejoin (page load, reconnect, game reset seen by an open page). It may only resume a team of the current game; it never creates one.
    async join(rawName: unknown, token: unknown, rejoinOnly = false) {
      const name = typeof rawName === "string" ? rawName.trim().slice(0, 32) : "";
      if (!name) return fail("Geçerli bir takım adı girin.");
      const meta = await store.readMeta();
      const claim = readTeamToken(token);
      // A token from before "Oyunu sıfırla" belongs to a game that no longer exists, so the team joins as a new team.
      const existing = claim?.gameId === meta.gameId ? await store.getTeam(meta.gameId, claim.teamId) : null;
      if (existing) {
        const status = statusOf(existing);
        // Rejoining never renames: the host approved this name. Nothing is written, so a rejoin can't race an approval.
        if (status === "pending" || status === "approved") return { ok: true, gameId: meta.gameId, teamId: existing.id, token: teamToken(meta.gameId, existing.id), name: existing.name, teamStatus: status };
        // A rejected or removed team may apply again, but only under a different name.
        if (sameName(existing.name, name)) return fail(refusal[status]);
      }
      // The saved team belongs to a game that was reset: the phone must ask its player before applying again.
      if (rejoinOnly) return { ok: false, expired: true, message: "" };
      const team: TeamRecord = { id: crypto.randomUUID(), name, status: approvalOn(meta) ? "pending" : "approved", joinedAt: Date.now() };
      await store.saveTeam(meta.gameId, team);
      await changed();
      return { ok: true, gameId: meta.gameId, teamId: team.id, token: teamToken(meta.gameId, team.id), name, teamStatus: team.status };
    },
    async submit(token: unknown, answer: unknown, rawJokerIndex: unknown): Promise<Result> {
      const claim = readTeamToken(token);
      const meta = await store.readMeta();
      const team = claim && claim.gameId === meta.gameId ? await store.getTeam(meta.gameId, claim.teamId) : null;
      if (!team) return fail("Önce lobiye katılın.");
      if (statusOf(team) !== "approved") return fail(refusal[statusOf(team)]);
      if (typeof answer !== "string" || !answer.trim() || answer.length > 64) return fail("Geçerli bir cevap girin.");
      const round = meta.round;
      if (!round || !isRoundOpen(meta, round.id, Date.now())) return fail(closedMessage);
      const jokerIndex = typeof rawJokerIndex === "number" ? rawJokerIndex : null;
      const item = "letters" in round ? await validateWord(team.id, answer, jokerIndex, round) : validateNumber(team.id, answer, round);
      if (!item) return fail("TDK sözlüğüne ulaşılamadı. Lütfen tekrar deneyin.");
      if (!item.buildValid) return fail("letters" in round ? "Kelime verilen harfler ve jokerle oluşturulmalı." : "İfade kurallara uymuyor.");
      if ("letters" in round && !item.dictionaryValid) return fail("Kelime TDK sözlüğünde bulunamadı.");
      // The round may have ended or been paused during the TDK lookup; addSubmission re-checks that atomically before scoring.
      const result = await store.addSubmission(meta, round.id, item);
      if (result === "closed") return fail(closedMessage);
      if (result === "duplicate") return fail("Bu cevabı zaten gönderdiniz.");
      await changed();
      return { ok: true, message: "letters" in round ? "Cevabınız alındı." : "Cevabınız alındı. Puanlar tur sonunda verilecek." };
    },
    async hostLogin(pin: unknown, client: string) {
      if (!hostPin) return fail("Host PIN'i sunucuda tanımlı değil.");
      if (await store.hit(`login:${client}`, 10 * 60) > 10) return fail("Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.");
      return pinMatches(pin) ? { ok: true, token: hostToken() } : fail("PIN doğrulanamadı.");
    },
    async results() {
      const meta = await store.readMeta();
      const teams = publicTeams(meta, await rankedTeams(meta));
      return { teams, rounds: config.rounds.length, matchRound: meta.matchRound, submissions: await roundSubmissions(meta, teams) };
    },
  };
}
