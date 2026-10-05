import crypto from "node:crypto";
import type { NumberRound } from "./numberGame.js";
import type { WordRound } from "./wordGame.js";

export type GamePhase = "lobby" | "word" | "number" | "round-results" | "game-results";
// gameId changes on "Oyunu sıfırla" (invalidating team tokens); series changes on "Yeni oyun" (fresh scores, same teams).
// approvalRequired is missing on games created before host approval existed; approvalOn() treats that as on.
export type Meta = { gameId: string; series: number; rev: number; phase: GamePhase; matchRound: number; round: WordRound | NumberRound | null; pausedRemainingMs: number | null; approvalRequired?: boolean };
export type TeamStatus = "pending" | "approved" | "rejected" | "removed";
// status and joinedAt are missing on teams created before host approval existed; statusOf() treats those teams as approved.
export type TeamRecord = { id: string; name: string; status?: TeamStatus; joinedAt?: number };
export type Submission = { teamId: string; answer: string; value?: number; dictionaryValid?: boolean; meanings?: string[]; buildValid: boolean; jokerUsed?: boolean; status: "accepted" | "rejected"; score: number };
export type SubmitResult = "ok" | "duplicate" | "closed";

// All game data lives behind this interface: MemoryStore locally, RedisStore on Vercel. Every method must be atomic on its own.
export interface Store {
  readMeta(): Promise<Meta>;
  // Compare-and-set: writes only if the stored rev still equals expectedRev.
  writeMeta(next: Meta, expectedRev: number): Promise<boolean>;
  readVersion(): Promise<number>;
  bumpVersion(): Promise<number>;
  listTeams(gameId: string): Promise<TeamRecord[]>;
  getTeam(gameId: string, teamId: string): Promise<TeamRecord | null>;
  saveTeam(gameId: string, team: TeamRecord): Promise<void>;
  scores(gameId: string, series: number): Promise<Record<string, number>>;
  listSubmissions(roundId: string): Promise<Submission[]>;
  // Re-checks against the stored meta that the round is still open, rejects a repeated answer, records it and adds its score, all in one step.
  // meta must be the snapshot the round was read from: its gameId and series pick the score table.
  addSubmission(meta: Pick<Meta, "gameId" | "series">, roundId: string, submission: Submission): Promise<SubmitResult>;
  getCache(key: string): Promise<string | null>;
  setCache(key: string, value: string, ttlSeconds: number): Promise<void>;
  // Counts hits on key within a fixed window and returns the new count.
  hit(key: string, windowSeconds: number): Promise<number>;
}

export function initialMeta(): Meta { return { gameId: crypto.randomUUID(), series: 0, rev: 0, phase: "lobby", matchRound: 0, round: null, pausedRemainingMs: null, approvalRequired: true }; }
export function approvalOn(meta: Meta) { return meta.approvalRequired !== false; }
export function statusOf(team: TeamRecord): TeamStatus { return team.status ?? "approved"; }
export function isActive(meta: Meta) { return meta.phase === "word" || meta.phase === "number"; }
export function isExpired(meta: Meta, now: number) { return isActive(meta) && meta.pausedRemainingMs === null && meta.round !== null && now >= meta.round.endsAt; }
export function isRoundOpen(meta: Meta, roundId: string, now: number) { return isActive(meta) && meta.round?.id === roundId && meta.pausedRemainingMs === null && now < meta.round.endsAt; }
export function submissionKey(submission: Submission) { return `${submission.teamId}\u0000${submission.answer}`; }

export function createMemoryStore(): Store {
  let meta = initialMeta();
  // Starting from the clock keeps versions increasing across dev-server restarts; open pages ignore any version lower than one they've seen.
  let version = Date.now();
  const teams = new Map<string, Map<string, TeamRecord>>();
  const scores = new Map<string, Map<string, number>>();
  const submissions = new Map<string, Map<string, Submission>>();
  const cache = new Map<string, { value: string; expiresAt: number }>();
  const hits = new Map<string, { count: number; expiresAt: number }>();
  const tableFor = <T>(tables: Map<string, Map<string, T>>, key: string) => { const table = tables.get(key) ?? new Map<string, T>(); tables.set(key, table); return table; };
  return {
    async readMeta() { return structuredClone(meta); },
    async writeMeta(next, expectedRev) { if (meta.rev !== expectedRev) return false; meta = structuredClone(next); return true; },
    async readVersion() { return version; },
    async bumpVersion() { version += 1; return version; },
    async listTeams(gameId) { return [...(teams.get(gameId)?.values() ?? [])].map((team) => ({ ...team })); },
    async getTeam(gameId, teamId) { const team = teams.get(gameId)?.get(teamId); return team ? { ...team } : null; },
    async saveTeam(gameId, team) { tableFor(teams, gameId).set(team.id, { ...team }); },
    async scores(gameId, series) { return Object.fromEntries(scores.get(`${gameId}:${series}`) ?? []); },
    async listSubmissions(roundId) { return [...(submissions.get(roundId)?.values() ?? [])].map((submission) => structuredClone(submission)); },
    async addSubmission(owner, roundId, submission) {
      if (!isRoundOpen(meta, roundId, Date.now())) return "closed";
      const round = tableFor(submissions, roundId);
      if (round.has(submissionKey(submission))) return "duplicate";
      round.set(submissionKey(submission), structuredClone(submission));
      if (submission.status === "accepted") { const table = tableFor(scores, `${owner.gameId}:${owner.series}`); table.set(submission.teamId, (table.get(submission.teamId) ?? 0) + submission.score); }
      return "ok";
    },
    async getCache(key) { const entry = cache.get(key); return entry && entry.expiresAt > Date.now() ? entry.value : null; },
    async setCache(key, value, ttlSeconds) { cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 }); },
    async hit(key, windowSeconds) { const now = Date.now(); const entry = hits.get(key); const next = entry && entry.expiresAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, expiresAt: now + windowSeconds * 1000 }; hits.set(key, next); return next.count; },
  };
}
