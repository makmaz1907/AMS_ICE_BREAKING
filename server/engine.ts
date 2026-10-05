import crypto from "node:crypto";
import rawConfig from "../config/game.json" with { type: "json" };
import { hostPin, hostToken, pinMatches, readTeamToken, teamToken } from "./auth.js";
import { createNumberRound, evaluateNumberExpression, scoreNumber } from "./numberGame.js";
import { initialMeta, isActive, isExpired, isRoundOpen, type Meta, type Store, type Submission } from "./store.js";
import { lookupTdk, type TdkLookup } from "./tdk.js";
import { canBuildWord, createWordRound, normalizeTurkish, scoreWord } from "./wordGame.js";

type RoundConfig = { type: "word" | "number"; durationSeconds: number };
type GameConfig = { rounds: RoundConfig[]; teamMode: "team" | "individual"; predefinedTeams: string[]; themedWord: string; targetNumber: number | null; targetDescription: string };
export type Notifier = { publish(version: number): Promise<void> };
export type Result = { ok: boolean; message?: string };
export type HostAction = "start" | "finish" | "pause" | "add-time" | "reset";
export type Engine = ReturnType<typeof createEngine>;
type PublicState = Record<string, unknown> & { version: number };

const defaults: GameConfig = { rounds: [{ type: "word", durationSeconds: 60 }, { type: "word", durationSeconds: 60 }, { type: "word", durationSeconds: 60 }, { type: "number", durationSeconds: 90 }, { type: "number", durationSeconds: 90 }], teamMode: "team", predefinedTeams: [], themedWord: "", targetNumber: null, targetDescription: "" };
const parsed = rawConfig as Partial<GameConfig>;
const config: GameConfig = { ...defaults, ...parsed, rounds: parsed.rounds?.length ? parsed.rounds : defaults.rounds };
const closedMessage = "Bu tur için cevap kabul edilmiyor.";
const fail = (message: string) => ({ ok: false, message });

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
  function tick() { return mutate((meta) => isExpired(meta, Date.now()) ? finished(meta) : null); }

  const commands: Record<HostAction, (meta: Meta, seconds: number) => Meta | null> = {
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
    "add-time": (meta, seconds) => {
      if (!isActive(meta) || !meta.round || !(seconds > 0 && seconds <= 600)) return null;
      return meta.pausedRemainingMs !== null ? { ...meta, pausedRemainingMs: meta.pausedRemainingMs + seconds * 1000 } : { ...meta, round: { ...meta.round, endsAt: meta.round.endsAt + seconds * 1000 } };
    },
    reset: () => initialMeta(),
  };

  async function rankedTeams(meta: Meta) {
    const [teams, scores] = await Promise.all([store.listTeams(meta.gameId), store.scores(meta.gameId, meta.series)]);
    return teams.map((team) => ({ ...team, score: scores[team.id] ?? 0 })).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "tr-TR"));
  }
  async function roundSubmissions(meta: Meta, teams: Array<{ id: string; name: string }>) {
    if (!meta.round) return [];
    const names = new Map(teams.map((team) => [team.id, team.name]));
    return (await store.listSubmissions(meta.round.id)).map((submission) => ({ ...submission, teamName: names.get(submission.teamId) ?? "Bilinmeyen takım" })).sort((left, right) => right.score - left.score || left.teamName.localeCompare(right.teamName, "tr-TR"));
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
    const teams = await rankedTeams(meta);
    const roundType = config.rounds[meta.matchRound - 1]?.type ?? null;
    const showResults = meta.phase === "round-results" || meta.phase === "game-results";
    return {
      gameId: meta.gameId, version, serverNow: Date.now(), phase: meta.phase, teams, round: serializeRound(meta),
      submissions: showResults ? await roundSubmissions(meta, teams) : [], matchRound: meta.matchRound, totalRounds: config.rounds.length, roundType, teamMode: config.teamMode,
      winner: meta.phase === "game-results" ? teams[0] ?? null : null,
      numberSolution: meta.phase === "round-results" && meta.round && "solution" in meta.round ? meta.round.solution : null,
      themedWord: meta.phase === "round-results" && roundType === "word" ? config.themedWord || null : null,
      paused: meta.pausedRemainingMs !== null, remainingMs: meta.pausedRemainingMs,
    };
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
    return { teamId, answer: expression, value: result.value, buildValid: true, status: "accepted", score: scoreNumber(result.value!, round.target) };
  }

  return {
    state,
    tick,
    async command(action: unknown, seconds: unknown): Promise<Result> {
      if (typeof action !== "string" || !(action in commands)) return fail("Bilinmeyen komut.");
      await mutate((meta) => commands[action as HostAction](meta, Number(seconds)));
      return { ok: true };
    },
    async join(rawName: unknown, token: unknown) {
      const name = typeof rawName === "string" ? rawName.trim().slice(0, 32) : "";
      if (!name) return fail("Geçerli bir takım adı girin.");
      const meta = await store.readMeta();
      const claim = readTeamToken(token);
      // A token from before "Oyunu sıfırla" belongs to a game that no longer exists, so the team joins as a new team.
      const teamId = claim?.gameId === meta.gameId ? claim.teamId : crypto.randomUUID();
      await store.saveTeam(meta.gameId, { id: teamId, name });
      await changed();
      return { ok: true, gameId: meta.gameId, teamId, token: teamToken(meta.gameId, teamId) };
    },
    async submit(token: unknown, answer: unknown, rawJokerIndex: unknown): Promise<Result> {
      const claim = readTeamToken(token);
      const meta = await store.readMeta();
      if (!claim || claim.gameId !== meta.gameId || !(await store.getTeam(meta.gameId, claim.teamId))) return fail("Önce lobiye katılın.");
      if (typeof answer !== "string" || !answer.trim() || answer.length > 64) return fail("Geçerli bir cevap girin.");
      const round = meta.round;
      if (!round || !isRoundOpen(meta, round.id, Date.now())) return fail(closedMessage);
      const jokerIndex = typeof rawJokerIndex === "number" ? rawJokerIndex : null;
      const item = "letters" in round ? await validateWord(claim.teamId, answer, jokerIndex, round) : validateNumber(claim.teamId, answer, round);
      if (!item) return fail("TDK sözlüğüne ulaşılamadı. Lütfen tekrar deneyin.");
      if (!item.buildValid) return fail("letters" in round ? "Kelime verilen harfler ve jokerle oluşturulmalı." : "İfade kurallara uymuyor.");
      if ("letters" in round && !item.dictionaryValid) return fail("Kelime TDK sözlüğünde bulunamadı.");
      // The round may have ended or been paused during the TDK lookup; addSubmission re-checks that atomically before scoring.
      const result = await store.addSubmission(meta, round.id, item);
      if (result === "closed") return fail(closedMessage);
      if (result === "duplicate") return fail("Bu cevabı zaten gönderdiniz.");
      await changed();
      return { ok: true, message: "Cevabınız alındı." };
    },
    async hostLogin(pin: unknown, client: string) {
      if (!hostPin) return fail("Host PIN'i sunucuda tanımlı değil.");
      if (await store.hit(`login:${client}`, 10 * 60) > 10) return fail("Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.");
      return pinMatches(pin) ? { ok: true, token: hostToken() } : fail("PIN doğrulanamadı.");
    },
    async results() {
      const meta = await store.readMeta();
      const teams = await rankedTeams(meta);
      return { teams, rounds: config.rounds.length, matchRound: meta.matchRound, submissions: await roundSubmissions(meta, teams) };
    },
  };
}
